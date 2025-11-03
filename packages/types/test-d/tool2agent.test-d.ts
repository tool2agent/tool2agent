import {
  type ToolCallAccepted,
  type ToolCallRejected,
  type ParameterFeedback,
  type FreeFormFeedback,
  type AcceptableValues,
  type SingleParameterFeedback,
  ParameterFeedbackCommon,
} from '../src/tool2agent.js';
import * as z from 'zod';

// The purpose of this file is to assert compile-time types only (no runtime).

type TestParams = {
  name: string;
  age: number;
  email?: string;
};

// ==================== ToolCallAccepted Tests ====================

// Valid: Accepted tool call with all required fields
const validAccepted: ToolCallAccepted<TestParams> = {
  ok: true,
  name: 'John',
  age: 30,
};

// Valid: Accepted with optional feedback
const validAcceptedWithFeedback: ToolCallAccepted<TestParams> = {
  ok: true,
  name: 'John',
  age: 30,
  feedback: ['Good input'],
};

// Valid: Accepted with instructions
const validAcceptedWithInstructions: ToolCallAccepted<TestParams> = {
  ok: true,
  name: 'John',
  age: 30,
  instructions: ['Please continue'],
};

// Valid: Accepted with instructions
const invalidAcceptedDueToCollision: ToolCallAccepted<{ feedback: number[] }> = {
  ok: true,
  // @ts-expect-error - feedback is not a string
  feedback: [1],
};

// Valid: Accepted with object keys that collide with the ToolCallAccepted type
const validAcceptedDespiteCollision2: ToolCallAccepted<{ ok: boolean }> = {
  ok: true,
};

// @ts-expect-error - ok: string collides with ok: boolean, so the whole type becomes `never`
const inValidAcceptedDueToCollision3: ToolCallAccepted<{ ok: string }> = {};

const validAcceptedEmptyObject: ToolCallAccepted<{}> = {
  ok: true,
};

const emptyObjectSchema = z.object({});
const validAcceptedEmptyObject2: ToolCallAccepted<z.infer<typeof emptyObjectSchema>> = {
  ok: true,
};

const okTrueObjectSchema = z.object({ ok: z.literal(true) });
const validAcceptedOkTrue: ToolCallAccepted<z.infer<typeof okTrueObjectSchema>> = {
  ok: true,
};

const okNumberObjectSchema = z.object({ ok: z.number() });
const invalidAcceptedOkNumber: ToolCallAccepted<z.infer<typeof okNumberObjectSchema>> = {
  // @ts-expect-error - ok is not a boolean
  ok: true,
};

const invalidAcceptedOkNumber2: ToolCallAccepted<z.infer<typeof okNumberObjectSchema>> = {
  // @ts-expect-error - ok is not a boolean
  ok: 1,
};

const feedbackObjectSchema = z.object({ feedback: z.array(z.string()) });
const validAcceptedFeedback: ToolCallAccepted<z.infer<typeof feedbackObjectSchema>> = {
  ok: true,
  feedback: ['Good input'],
};

const feedbackNumbersSchema = z.object({ feedback: z.array(z.number()) });
const invalidAcceptedFeedbackNumbers: ToolCallAccepted<z.infer<typeof feedbackNumbersSchema>> = {
  ok: true,
  // @ts-expect-error - feedback is not an array of strings
  feedback: [1, 2, 3],
};

// Invalid: Missing value field - demonstrate via function parameter
function expectAccepted(x: ToolCallAccepted<TestParams>) {}
// @ts-expect-error - value is required
expectAccepted({ ok: true });

// Valid: Empty feedback can't be assigned directly but TypeScript catches it at array level
// We demonstrate that NonEmptyArray type prevents empty arrays
function checkFeedback(x: ToolCallAccepted<TestParams>) {}
const emptyFeedback: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkFeedback({ ok: true, value: { name: 'John', age: 30 }, feedback: emptyFeedback });

// ==================== ToolCallRejected Tests ====================

// Valid: Rejected with validation results
const validRejectedWithValidation: ToolCallRejected<TestParams> = {
  ok: false,
  validationResults: {
    name: {
      valid: false,
      problems: ['Name is too short'],
    },
  },
};

// Valid: Rejected with validation results
const invalidRejectedWithValidation: ToolCallRejected<TestParams> = {
  ok: false,
  // @ts-expect-error - need at least one key here
  validationResults: {},
};

// @ts-expect-error - need at least one key here
const invalidRejectedWithValidation2: ToolCallRejected<TestParams> = {
  ok: false,
};

// Valid: Rejected with problems
const validRejectedWithReasons: ToolCallRejected<TestParams> = {
  ok: false,
  problems: ['System unavailable'],
};

// Valid: Rejected with both validation results and rejection reasons
const validRejectedWithBoth: ToolCallRejected<TestParams> = {
  ok: false,
  validationResults: {
    age: {
      valid: false,
      problems: ['Age is out of range'],
    },
  },
  problems: ['Additional system error'],
};

// Invalid: Rejected with neither validation results nor rejection reasons (violates AtLeastOne)
// Demonstrated via function parameter
function expectRejected(x: ToolCallRejected<TestParams>) {}
// @ts-expect-error - at least one of validationResults or problems is required
expectRejected({ ok: false });

// Demonstrate empty problems detection
function checkRejected(x: ToolCallRejected<TestParams>) {}
const emptyReasons: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkRejected({ ok: false, problems: emptyReasons });

// ==================== ParameterFeedback Tests ====================

// Valid: Parameter feedback with valid status
const validParamFeedbackValid: ParameterFeedback<TestParams, 'name'> = {
  valid: true,
};

// Valid: Parameter feedback with valid status and normalized value
const validParamFeedbackNormalized: ParameterFeedback<TestParams, 'name'> = {
  valid: true,
  normalizedValue: 'JOHN',
};

// Valid: Parameter feedback with valid status and allowed values
const validParamFeedbackAllowed: ParameterFeedback<TestParams, 'name'> = {
  valid: true,
  allowedValues: ['John', 'Jane', 'Bob'],
};

// Valid: Parameter feedback with invalid status and refusal reasons
const validParamFeedbackInvalid: ParameterFeedback<TestParams, 'name'> = {
  valid: false,
  problems: ['Name contains invalid characters'],
};

// Valid: Parameter feedback with invalid status and requires valid parameters
const validParamFeedbackRequires: ParameterFeedback<TestParams, 'email'> = {
  valid: false,
  requiresValidParameters: ['name'],
};

// Invalid: Parameter feedback with invalid status but no refusal info (violates AtLeastOne)
// Demonstrated via function parameter
function expectParamFeedbackInvalid(x: ParameterFeedback<TestParams, 'name'>) {}
// @ts-expect-error - invalid feedback must have problems or requiresValidParameters
expectParamFeedbackInvalid({ valid: false });

// Demonstrate empty array detection for parameter feedback
function checkParamFeedback(x: ParameterFeedback<TestParams, 'name'>) {}
const emptyRefusalReasons: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkParamFeedback({ valid: false, problems: emptyRefusalReasons });

const emptyRequires: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkParamFeedback({ valid: false, requiresValidParameters: emptyRequires });

// ==================== AcceptableValues Tests ====================

// Valid: No acceptable values specified
const validAcceptableNone: AcceptableValues<string> = {};

// Valid: Only allowedValues provided
const validAcceptableAllowed: AcceptableValues<string> = {
  allowedValues: ['option1', 'option2'],
};

// Valid: Only suggestedValues provided
const validAcceptableSuggested: AcceptableValues<string> = {
  suggestedValues: ['suggestion1', 'suggestion2'],
};

// Valid: Empty allowedValues array (indicates no options available)
const validAcceptableEmptyAllowed: AcceptableValues<string> = {
  allowedValues: [],
};

// Invalid: Both allowedValues and suggestedValues (violates AtMostOne)
// @ts-expect-error - at most one of allowedValues or suggestedValues can be provided
const invalidAcceptableBoth: AcceptableValues<string> = {
  allowedValues: ['option1'],
  suggestedValues: ['suggestion1'],
};

// Demonstrate empty suggestedValues detection
function checkAcceptable(x: AcceptableValues<string>) {}
const emptySuggested: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkAcceptable({ suggestedValues: emptySuggested });

// ==================== FreeFormFeedback Tests ====================

// Valid: No feedback
const validFeedbackNone: FreeFormFeedback = {};

// Valid: With feedback array
const validFeedbackWithFeedback: FreeFormFeedback = {
  feedback: ['Message 1', 'Message 2'],
};

// Valid: With instructions array
const validFeedbackWithInstructions: FreeFormFeedback = {
  instructions: ['Instruction 1'],
};

// Demonstrate empty feedback/instructions detection
function checkFreeForm(x: FreeFormFeedback) {}
const emptyFeedbackArray: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkFreeForm({ feedback: emptyFeedbackArray });

const emptyInstructions: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkFreeForm({ instructions: emptyInstructions });

// =========================== Dynamic parameter schema ================

const schema = z.object({
  field: z.enum(['a', 'b']),
  another: z.string(),
});

type SchemaType = z.infer<typeof schema>;

type JustType = {
  field: string;
};

// Valid: schema type is a subtype of JustType:
// - 'a' | 'b' < string
// - `another` field is not present in the type, but present in the schema
const paramFeedback: ParameterFeedbackCommon<JustType> = {
  dynamicParameterSchema: schema,
};

const paramFeedbackWrongSchema: ParameterFeedbackCommon<JustType> = {
  // @ts-expect-error `field` is not provided in the schema
  dynamicParameterSchema: z.object({
    someOtherField: z.enum(['a', 'b']),
  }),
};

// ==================== ParameterFeedbackCommon dynamicParameterSchema Variance ====================

const animalSchema = z.object({ species: z.string() });
const dogSchema = z.object({ species: z.literal('dog'), barks: z.literal(true) });

type Animal = z.infer<typeof animalSchema>;
type Dog = z.infer<typeof dogSchema>;

// Valid: subtype schema is assignable to ParameterFeedbackCommon of the supertype
const validPfAnimal: ParameterFeedbackCommon<Animal> = {
  dynamicParameterSchema: dogSchema,
};

// Invalid: supertype schema is not assignable to ParameterFeedbackCommon of the subtype
const invalidPfDog: ParameterFeedbackCommon<Dog> = {
  // @ts-expect-error - supertype schema should not be assignable to subtype feedback
  dynamicParameterSchema: animalSchema,
};

// ==================== Empty output schema ====================

const emptyOutputSchema = z.never();
type EmptyOutputType = z.infer<typeof emptyOutputSchema>;

const validAcceptedEmpty: ToolCallAccepted<never> = {
  ok: true,
};

// ==================== SingleParameterFeedback Tests ====================

// Valid: SingleParameterFeedback with required problems field
const validSinglePfProblems: SingleParameterFeedback<string> = {
  problems: ['Invalid format'],
};

// Valid: SingleParameterFeedback with problems and normalizedValue
const validSinglePfNormalized: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  normalizedValue: 'normalized',
};

// Valid: SingleParameterFeedback with problems and dynamicParameterSchema
const validSinglePfDynamic: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  dynamicParameterSchema: z.enum(['a', 'b']),
};

// Valid: SingleParameterFeedback with problems and feedback
const validSinglePfFeedback: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  feedback: ['Please correct'],
};

// Valid: SingleParameterFeedback with problems and instructions
const validSinglePfInstructions: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  instructions: ['Follow these steps'],
};

// Valid: SingleParameterFeedback with problems and allowedValues (empty array)
const validSinglePfEmptyAllowed: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  allowedValues: [],
};

// Valid: SingleParameterFeedback with problems and allowedValues (non-empty)
const validSinglePfAllowed: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  allowedValues: ['valid1', 'valid2'],
};

// Valid: SingleParameterFeedback with problems and suggestedValues
const validSinglePfSuggested: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  suggestedValues: ['valid1', 'valid2'],
};

// Valid: SingleParameterFeedback with all optional fields combined
const validSinglePfAllFields: SingleParameterFeedback<string> = {
  problems: ['Invalid format'],
  normalizedValue: 'normalized',
  dynamicParameterSchema: z.string(),
  feedback: ['Feedback'],
  instructions: ['Instructions'],
  allowedValues: ['valid1'],
};

// Valid: SingleParameterFeedback with suggestedValues instead of allowedValues
const validSinglePfAllFieldsSuggested: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  normalizedValue: 'normalized',
  dynamicParameterSchema: z.string(),
  feedback: ['Feedback'],
  instructions: ['Instructions'],
  suggestedValues: ['valid1', 'valid2'],
};

// Valid: SingleParameterFeedback with none of allowedValues/suggestedValues (empty AcceptableValues)
const validSinglePfNoAcceptableValues: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  normalizedValue: 'normalized',
  dynamicParameterSchema: z.string(),
  feedback: ['Feedback'],
  instructions: ['Instructions'],
};

// Invalid: Missing required problems field
function expectSinglePf(x: SingleParameterFeedback<string>) {}
// @ts-expect-error - problems is required
expectSinglePf({
  normalizedValue: 'normalized',
});

// Invalid: Both allowedValues and suggestedValues (violates AtMostOne)
// @ts-expect-error - at most one of allowedValues or suggestedValues can be provided
const invalidSinglePfBothValues: SingleParameterFeedback<string> = {
  problems: ['Invalid'],
  allowedValues: ['a'],
  suggestedValues: ['b'],
};

// Invalid: Empty problems array
function checkSinglePf(x: SingleParameterFeedback<string>) {}
const emptyProblems: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkSinglePf({ problems: emptyProblems });

// Invalid: Empty feedback array
const emptyFeedbackForSinglePf: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkSinglePf({ problems: ['Invalid'], feedback: emptyFeedbackForSinglePf });

// Invalid: Empty instructions array
const emptyInstructionsForSinglePf: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkSinglePf({ problems: ['Invalid'], instructions: emptyInstructionsForSinglePf });

// Invalid: Empty suggestedValues array
const emptySuggestedForSinglePf: [] = [];
// @ts-expect-error - empty array cannot be NonEmptyArray
checkSinglePf({ problems: ['Invalid'], suggestedValues: emptySuggestedForSinglePf });

// ==================== ToolCallRejected with Non-Record Input Types ====================

// Valid: Rejected with non-record input (string) - uses SingleParameterFeedback
const validRejectedString: ToolCallRejected<string> = {
  ok: false,
  problems: ['Invalid format'],
};

// Valid: Rejected with non-record input (string) - with all SingleParameterFeedback fields
const validRejectedStringFull: ToolCallRejected<string> = {
  ok: false,
  problems: ['Invalid'],
  normalizedValue: 'normalized',
  dynamicParameterSchema: z.string(),
  feedback: ['Feedback'],
  instructions: ['Instructions'],
  allowedValues: ['valid1'],
};

// Valid: Rejected with non-record input (number)
const validRejectedNumber: ToolCallRejected<number> = {
  ok: false,
  problems: ['Number too large'],
  suggestedValues: [42, 100],
};

// Valid: Rejected with non-record input (array)
const validRejectedArray: ToolCallRejected<string[]> = {
  ok: false,
  problems: ['Array too short'],
  allowedValues: [['a', 'b']],
};

// Invalid: Rejected with non-record input but missing problems (required)
function expectRejectedString(x: ToolCallRejected<string>) {}
// @ts-expect-error - problems is required for SingleParameterFeedback
expectRejectedString({
  ok: false,
  normalizedValue: 'normalized',
});

// Invalid: Rejected with non-record input but has validationResults (not allowed for non-records)
const invalidRejectedStringWithValidation: ToolCallRejected<string> = {
  ok: false,
  problems: ['Invalid'],
  // @ts-expect-error - validationResults does not exist in ToolCallRejected for non-record inputs
  validationResults: {},
};
