import 'dotenv/config';
import { z } from 'zod';
import { tool2agent } from '../src/index.js';
import type { ToolCallResult } from '@tool2agent/types';
import { generateText, stepCountIs } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

// This example demonstrates the `dynamicParameterSchema` feature of tool2agent.
//
// The scenario: A dynamic form submission system where the expected structure
// of form data depends on the form type selected. The tool returns
// `dynamicParameterSchema` to inform the LLM about the exact shape of data
// expected at runtime.
//
// Key concepts:
// - `dynamicParameterSchema`: A Zod schema returned in validation results that
//   tells the LLM the exact structure expected for a parameter. This is useful
//   when the schema can't be known at design time.
// - Runtime schema determination: The form data schema changes based on which
//   form type is selected.

// Define the available form types and their dynamic schemas
type FormType = 'contact' | 'feedback' | 'support';

// Form data is an arbitrary JSON object at design time
const formDataSchema = z.record(z.string(), z.unknown());

// Dynamic schemas for each form type - determined at runtime
const FORM_SCHEMAS: Record<FormType, z.ZodType<Record<string, unknown>>> = {
  contact: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    message: z.string().min(10),
  }),
  feedback: z.object({
    rating: z.number().min(1).max(5),
    category: z.enum(['product', 'service', 'website', 'other']),
    comment: z.string().optional(),
  }),
  support: z.object({
    ticketId: z.string().regex(/^TKT-\d{4}$/, 'Must match format TKT-XXXX'),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    description: z.string().min(20),
    contactEmail: z.string().email(),
  }),
};

// Input and output schemas for the form submission tool
const inputSchema = z.object({
  formType: z.enum(['contact', 'feedback', 'support']),
  formData: formDataSchema,
});

const outputSchema = z.object({
  submissionId: z.string(),
  message: z.string(),
});

type FormInput = z.infer<typeof inputSchema>;
type FormOutput = z.infer<typeof outputSchema>;

// Simulated submission storage
let submissionCounter = 1000;

// Create the form submission tool
const submitFormTool = tool2agent({
  description:
    'Submit a form. The structure of formData depends on the formType. ' +
    'Call this tool to discover the required schema for the selected form type.',
  inputSchema,
  outputSchema,
  execute: async (params: Partial<FormInput>): Promise<ToolCallResult<FormInput, FormOutput>> => {
    console.log('\n📋 Form submission attempt:', JSON.stringify(params, null, 2));

    const { formType, formData } = params;

    // Validate formType first
    if (!formType) {
      return {
        ok: false,
        validationResults: {
          formType: {
            valid: false,
            problems: ['Form type is required'],
            allowedValues: ['contact', 'feedback', 'support'] as FormType[],
          },
        },
      };
    }

    // Get the dynamic schema for this form type
    const dynamicSchema = FORM_SCHEMAS[formType];
    if (!dynamicSchema) {
      return {
        ok: false,
        validationResults: {
          formType: {
            valid: false,
            problems: [`Unknown form type: ${formType}`],
            allowedValues: ['contact', 'feedback', 'support'] as FormType[],
          },
        },
      };
    }

    // Validate formData - if missing, return the dynamic schema so the LLM knows what to provide
    if (!formData || Object.keys(formData).length === 0) {
      return {
        ok: false,
        validationResults: {
          formType: { valid: true },
          formData: {
            valid: false,
            problems: ['Form data is required'],
            // KEY FEATURE: Return the dynamic schema for this form type
            // This tells the LLM exactly what structure is expected
            dynamicParameterSchema: dynamicSchema,
            instructions: [`Provide form data matching the schema for "${formType}" form type`],
          },
        },
      };
    }

    // Validate formData against the dynamic schema
    const parseResult = dynamicSchema.safeParse(formData);

    if (!parseResult.success) {
      // Extract validation errors
      const errors = parseResult.error.issues.map(
        issue => `${issue.path.join('.')}: ${issue.message}`,
      );

      return {
        ok: false,
        validationResults: {
          formType: { valid: true },
          formData: {
            valid: false,
            problems: errors as [string, ...string[]],
            // Return the schema again to help the LLM fix its mistakes
            dynamicParameterSchema: dynamicSchema,
          },
        },
      };
    }

    // Success! Submit the form
    submissionCounter++;
    const submissionId = `SUB-${submissionCounter}`;

    console.log(`✅ Form submitted successfully!`);
    console.log(`   Submission ID: ${submissionId}`);
    console.log(`   Form Type: ${formType}`);
    console.log(`   Data:`, JSON.stringify(formData, null, 2));

    return {
      ok: true,
      submissionId,
      message: `Successfully submitted ${formType} form with ID ${submissionId}`,
    };
  },
});

async function run() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  console.log('=== Dynamic Schema Example ===\n');
  console.log('This example demonstrates how dynamicParameterSchema works.');
  console.log('The LLM will discover the form structure at runtime.\n');

  // Scenario: Ask the LLM to submit a support ticket
  const task =
    'I need to submit a support ticket about a login issue. ' +
    'My ticket ID is TKT-5678, priority should be high, ' +
    'and my email is user@example.com. ' +
    'The issue is that I cannot log in to my account since yesterday morning.';

  console.log('Task:', task);
  console.log('\n--- Starting LLM interaction ---\n');

  const model = openrouter('openai/gpt-4o-mini');

  const result = await generateText({
    model,
    providerOptions: {
      openai: { parallelToolCalls: false },
      openrouter: { parallelToolCalls: false },
    },
    system: `You are a helpful assistant that helps users submit forms.
Use the submitForm tool to submit forms. The tool will tell you the exact
structure required for each form type via its feedback.

If validation fails, examine the dynamicParameterSchema in the response
to understand what fields are required and their types, then try again
with the correct data structure.`,
    prompt: task,
    tools: { submitForm: submitFormTool },
    // Allow multiple steps for the LLM to discover the schema and retry
    stopWhen: stepCountIs(10),
  });

  console.log('\n--- LLM interaction complete ---\n');
  console.log('Final response:', result.text);
  console.log('\nSteps taken:', result.steps.length);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
