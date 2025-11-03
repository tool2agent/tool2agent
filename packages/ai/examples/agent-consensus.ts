import 'dotenv/config';
import { z } from 'zod';
import { tool2agent, createMiddleware, type Tool2Agent } from '../src/index.js';
import type { ToolCallResult } from '@tool2agent/types';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import {
  Place,
  Time,
  AgentName,
  KnowledgeBase,
  placeSchema,
  timeSchema,
  agentNameSchema,
  AgentGaveUpError,
  AllAgentsConfirmedError,
  type AgentConstraints,
} from './agent-consensus/types.js';
import { MailSystem } from './agent-consensus/mail.js';
import { formatKnowledgeBase, initializeKnowledgeBase } from './agent-consensus/knowledge-base.js';

// Single source of truth for agent constraints
const AGENT_CONSTRAINTS: AgentConstraints = {
  Alice: {
    bar: { morning: 'cannot', evening: 'can' },
    museum: { morning: 'can', evening: 'can' },
  },
  Bob: {
    bar: { morning: 'cannot', evening: 'can' },
    museum: { morning: 'cannot', evening: 'can' },
  },
  Carol: {
    bar: { morning: 'cannot', evening: 'cannot' },
    museum: { morning: 'can', evening: 'can' },
  },
  Dave: {
    bar: { morning: 'can', evening: 'can' },
    museum: { morning: 'can', evening: 'can' },
  },
};

// Create tools for an agent
function createAgentTools(
  agentName: AgentName,
  mailSystem: MailSystem,
  knowledgeBase: KnowledgeBase,
) {
  // Create a logging middleware factory
  function createLoggingMiddleware<InputType, OutputType>(toolName: string) {
    return createMiddleware<InputType, OutputType>({
      transform: (tool: Tool2Agent<InputType, OutputType>): Tool2Agent<InputType, OutputType> => {
        const { execute } = tool;
        return {
          ...tool,
          execute: async (input: InputType, options: ToolCallOptions) => {
            console.log(`🔧 ${toolName}[${agentName}] INPUT:`, JSON.stringify(input));
            const result = await execute(input, options);
            console.log(`🔧 ${toolName}[${agentName}] OUTPUT:`, JSON.stringify(result));
            return result;
          },
        } as Tool2Agent<InputType, OutputType>;
      },
    });
  }

  const mailOutputSchema = z.object({
    messages: z.array(
      z.object({
        from: z.string(),
        content: z.string(),
      }),
    ),
  });

  const proposeSchema = z.object({
    place: placeSchema,
    time: timeSchema,
  });

  const updateKnowledgeSchema = z.object({
    agent: agentNameSchema,
    place: placeSchema,
    time: timeSchema,
    status: z.enum(['can', 'cannot']),
  });

  const confirmSchema = z.object({
    place: placeSchema,
    time: timeSchema,
  });

  const rejectSchema = z.object({
    place: placeSchema,
    time: timeSchema,
  });

  const giveUpSchema = z.object({});

  // Types derived from schemas
  type MailOutput = z.infer<typeof mailOutputSchema>;
  type Propose = z.infer<typeof proposeSchema>;
  type UpdateKnowledge = z.infer<typeof updateKnowledgeSchema>;
  type Confirm = z.infer<typeof confirmSchema>;
  type Reject = z.infer<typeof rejectSchema>;
  type GiveUp = z.infer<typeof giveUpSchema>;

  // Helper function to validate place and time parameters
  function validatePlaceAndTime<OutputType>(
    place: Place,
    time: Time,
  ): ToolCallResult<{ place: Place; time: Time }, OutputType> {
    return {
      ok: true,
    } as ToolCallResult<{ place: Place; time: Time }, OutputType>;
  }

  // Helper function to check if agent can attend based on knowledge base
  function checkSelfCanAttend<OutputType>(
    place: Place,
    time: Time,
    errorMessage: string,
  ): ToolCallResult<{ place: Place; time: Time }, OutputType> | null {
    const selfMap = knowledgeBase.get(agentName);
    if (selfMap) {
      const timeMap = selfMap.get(place);
      if (timeMap) {
        const status = timeMap.get(time);
        if (status === 'cannot') {
          return {
            ok: false,
            problems: [errorMessage],
          } as ToolCallResult<{ place: Place; time: Time }, OutputType>;
        }
      }
    }
    return null;
  }

  // Helper function to find agents who cannot attend
  function findAgentsWhoCannotAttend(place: Place, time: Time): string[] {
    const allAgents: AgentName[] = agentNameSchema.options as AgentName[];
    const cannotAttend: string[] = [];

    for (const agent of allAgents) {
      const agentMap = knowledgeBase.get(agent);
      if (!agentMap) {
        continue;
      }
      const timeMap = agentMap.get(place);
      if (!timeMap) {
        continue;
      }
      const status = timeMap.get(time);

      if (status === 'cannot') {
        cannotAttend.push(agent);
      }
    }

    return cannotAttend;
  }

  // Helper function to find agents with missing knowledge
  function findAgentsWithMissingKnowledge(place: Place, time: Time): string[] {
    const allAgents: AgentName[] = agentNameSchema.options as AgentName[];
    const missingKnowledge: string[] = [];

    for (const agent of allAgents) {
      const agentMap = knowledgeBase.get(agent);
      if (!agentMap) {
        missingKnowledge.push(agent);
        continue;
      }
      const timeMap = agentMap.get(place);
      if (!timeMap) {
        missingKnowledge.push(agent);
        continue;
      }
      const status = timeMap.get(time);

      if (status !== 'can' && status !== 'cannot') {
        missingKnowledge.push(agent);
      }
    }

    return missingKnowledge;
  }
  const checkIfWorksForAll = (
    place: Place,
    time: Time,
  ): {
    works: boolean;
    feedback: string[];
  } => {
    const feedback: string[] = [];
    const allAgents: AgentName[] = agentNameSchema.options as AgentName[];
    let allCanGo = true;

    for (const agent of allAgents) {
      const agentMap = knowledgeBase.get(agent);
      if (!agentMap) {
        feedback.push(`Unknown if ${agent} can attend`);
        continue;
      }
      const timeMap = agentMap.get(place);
      if (!timeMap) {
        feedback.push(`Unknown if ${agent} can attend`);
        continue;
      }
      const status = timeMap.get(time);

      if (status === 'cannot') {
        allCanGo = false;
        feedback.push(`${agent} cannot attend ${place} at ${time}`);
      } else if (status === 'can') {
        feedback.push(`${agent} can attend ${place} at ${time}`);
      } else {
        feedback.push(`Unknown if ${agent} can attend ${place} at ${time}`);
      }
    }

    return { works: allCanGo, feedback };
  };

  const updateKnowledgeTool = createLoggingMiddleware<UpdateKnowledge, never>(
    'update_knowledge',
  ).applyTo(
    tool2agent({
      description: `Update your knowledge base about what an agent can or cannot do for a specific place and time. Use this when you learn (from messages or confirmations) that an agent can or cannot attend a particular place/time combination.`,
      inputSchema: updateKnowledgeSchema,
      outputSchema: z.never(),
      execute: async (params: UpdateKnowledge): Promise<ToolCallResult<UpdateKnowledge, never>> => {
        const agent = params.agent;
        const place = params.place;
        const time = params.time;
        const status = params.status;

        if (!agent || !place || !time || !status) {
          return {
            ok: false,
            validationResults: {
              agent: agent ? { valid: true } : { valid: false, problems: ['Agent is required'] },
              place: place ? { valid: true } : { valid: false, problems: ['Place is required'] },
              time: time ? { valid: true } : { valid: false, problems: ['Time is required'] },
              status: status ? { valid: true } : { valid: false, problems: ['Status is required'] },
            },
          };
        }

        const agentMap = knowledgeBase.get(agent);
        if (agentMap) {
          const timeMap = agentMap.get(place);
          if (timeMap) {
            const previousStatus = timeMap.get(time);
            timeMap.set(time, status);

            // Log knowledge update exhaustively
            const previousLog =
              previousStatus !== undefined ? ` (previous: ${previousStatus})` : ` (was unknown)`;
            console.log(
              `🧠 ${agentName} updated knowledge: ${agent} ${status} attend ${place} at ${time}${previousLog}`,
            );
          }
        }

        return {
          ok: true,
        };
      },
    }),
  );

  const proposeTool = createLoggingMiddleware<Propose, MailOutput>('propose').applyTo(
    tool2agent({
      description: `Propose a meeting place and time. This tool will check your knowledge base for conflicts and broadcast the proposal to all other agents, then return any unread messages.`,
      inputSchema: proposeSchema,
      outputSchema: mailOutputSchema,
      execute: async (params: Propose): Promise<ToolCallResult<Propose, MailOutput>> => {
        const place = params.place;
        const time = params.time;

        const validationError = validatePlaceAndTime<MailOutput>(place, time);
        if (validationError) {
          return validationError;
        }

        // Check knowledge base for this agent (like confirm does)
        const selfError = checkSelfCanAttend<MailOutput>(
          place!,
          time!,
          `You cannot propose ${place} at ${time} based on your constraints.`,
        );
        if (selfError) {
          return selfError;
        }

        // Check if any agents in knowledge base cannot attend
        const cannotAttend = findAgentsWhoCannotAttend(place!, time!);

        if (cannotAttend.length > 0) {
          return {
            ok: false,
            problems: [
              `Cannot propose: ${cannotAttend.join(', ')} cannot attend ${place} at ${time} according to your knowledge base.`,
            ],
          };
        }

        // Construct and broadcast the proposal message
        const content = `I propose we meet at ${place} in the ${time}.`;
        mailSystem.broadcastMessage(agentName, content);

        // Wait for new messages (polling)
        const messages = await mailSystem.waitForMessages(agentName, 2000);

        return {
          ok: true,
          messages: messages.map(m => ({
            from: m.from,
            content: m.content,
          })),
        };
      },
    }),
  );

  const confirmTool = createLoggingMiddleware<Confirm, never>('confirm').applyTo(
    tool2agent({
      description: `Confirm a meeting proposal. Call this when you agree to a specific place and time. All four agents must confirm the same place and time for the meeting to be scheduled.`,
      inputSchema: confirmSchema,
      outputSchema: z.never(),
      execute: async (params: Confirm): Promise<ToolCallResult<Confirm, never>> => {
        const place = params.place;
        const time = params.time;

        const validationError = validatePlaceAndTime<never>(place, time);
        if (validationError) {
          return validationError;
        }

        // Check knowledge base for this agent
        const selfError = checkSelfCanAttend<never>(
          place!,
          time!,
          `You cannot confirm ${place} at ${time} based on your constraints.`,
        );
        if (selfError) {
          return selfError;
        }

        // Check if ALL agents have 'can' status in knowledge base
        const cannotAttend = findAgentsWhoCannotAttend(place!, time!);
        const missingKnowledge = findAgentsWithMissingKnowledge(place!, time!);

        if (cannotAttend.length > 0) {
          return {
            ok: false,
            problems: [
              `Cannot confirm: ${cannotAttend.join(', ')} cannot attend ${place} at ${time} according to your knowledge base.`,
            ],
          };
        }

        if (missingKnowledge.length > 0) {
          return {
            ok: false,
            problems: [
              `Cannot confirm: You don't know if ${missingKnowledge.join(', ')} ${missingKnowledge.length === 1 ? 'can' : 'can'} attend ${place} at ${time}.`,
            ],
            instructions: ['Propose it first and wait for responses to update your knowledge'],
          };
        }

        mailSystem.confirm(agentName, place!, time!);
        return {
          ok: true,
        };
      },
    }),
  );

  const rejectTool = createLoggingMiddleware<Reject, {}>('reject').applyTo(
    tool2agent({
      description: `Reject a meeting proposal. Call this when you cannot attend a specific place and time. This will broadcast your rejection to all other agents.`,
      inputSchema: rejectSchema,
      outputSchema: z.object({}),
      execute: async (params: Reject): Promise<ToolCallResult<Reject, {}>> => {
        const place = params.place;
        const time = params.time;

        const validationError = validatePlaceAndTime<{}>(place, time);
        if (validationError) {
          return validationError;
        }

        // Broadcast the rejection message
        const content = `I cannot attend ${place} in the ${time}.`;
        mailSystem.broadcastMessage(agentName, content);

        return {
          ok: true,
        };
      },
    }),
  );

  const giveUpTool = createLoggingMiddleware<GiveUp, never>(
    /* gonna */ 'give_' /* you */ + 'up',
  ).applyTo(
    tool2agent({
      description: `Give up on finding a meeting time. Call this if you believe it's impossible to find a time and place that works for everyone.`,
      inputSchema: giveUpSchema,
      outputSchema: z.never(),
      execute: async (): Promise<ToolCallResult<GiveUp, never>> => {
        // Print knowledge base before giving up (since giveUp throws exception)
        console.log(`\n${formatKnowledgeBase(agentName, knowledgeBase)}\n`);

        mailSystem.giveUp(agentName);

        return {
          ok: true,
        };
      },
    }),
  );

  return {
    propose: proposeTool,
    update_knowledge: updateKnowledgeTool,
    confirm: confirmTool,
    reject: rejectTool,
    give_up: giveUpTool,
  };
}

// Run a single agent with a single generateText call
async function runAgent(agentName: AgentName, mailSystem: MailSystem): Promise<void> {
  const knowledgeBase = initializeKnowledgeBase(agentName, AGENT_CONSTRAINTS);
  const tools = createAgentTools(agentName, mailSystem, knowledgeBase);
  const model = openrouter('openai/gpt-5-mini');

  // Format constraints as text
  const constraints = AGENT_CONSTRAINTS[agentName];
  const constraintsText = Object.entries(constraints)
    .map(([place, times]) => {
      const timeEntries = Object.entries(times)
        .map(([time, status]) => `${time}: ${status}`)
        .join(', ');
      return `${place}: ${timeEntries}`;
    })
    .join('\n');

  const systemPrompt = `You are ${agentName}'s personal assistant. Your goal is to help ${agentName} find a meeting time and place with Alice, Bob, Carol, and Dave.

You have a knowledge base that tracks what each agent (including yourself) can or cannot do for each place/time combination. Initially, you only know your own constraints. You must learn about others' constraints through messages and update your knowledge base using the 'update_knowledge' tool.

CONSTRAINTS:
${constraintsText}

INSTRUCTIONS:

1. Propose any place/time that works for you using 'propose'.
2. When you learn new information about what agents can/cannot do, use 'update_knowledge' to record it
3. If you see a proposal that works for you, propose it too, otherwise reject it.
4. Wait till anyone agrees on the same place in writing
5. Call confirm tool to confirm the meeting
6. If you believe it's impossible to find a solution, use 'give_up'. DO NOT GIVE UP UNTIL YOU HAVE EXHAUSTED ALL THE OPTIONS.
7. Keep using 'propose' to send proposals and receive responses until a conclusion is reached.
8. If someone confirms a place/time you know won't work, give up

IMPORTANT:
- If someone can attend a place at a time, it does NOT mean that they can't attend it at another time.
- DO NOT ASK QUESTIONS. Just propose and reject proposals of others if it does not work. If a proposal does not work for you, you must say that it does not.
- Use 'propose' to send proposals and automatically receive new messages. The tool will return any messages that arrive after you send yours.
- Use 'update_knowledge' to track what you learn about each agent's availability.
`;

  console.log(`🤖 Starting ${agentName}'s assistant...`);

  const prompt = `Find a meeting place and time that works for everyone. Start by using 'propose' to propose an initial meeting option with both a place (bar or museum) and a time (morning or evening).`;

  // Custom stopWhen that stops immediately if agent confirmed or gave up
  const stopWhen = (step: any) => {
    // Stop if agent confirmed
    if (mailSystem.confirmations.has(agentName)) {
      return true;
    }
    // Stop if agent gave up
    if (mailSystem.givenUp.has(agentName)) {
      return true;
    }
    // Stop if step count limit reached
    if (step.stepCount >= 100) {
      return true;
    }
    return false;
  };

  await generateText({
    model,
    providerOptions: {
      openrouter: {
        parallelToolCalls: false,
      },
    },
    system: systemPrompt,
    prompt,
    tools,
    stopWhen,
  });

  // Check if someone gave up - if so, throw exception to stop experiment
  if (mailSystem.givenUp.size > 0) {
    const firstAgentToGiveUp = Array.from(mailSystem.givenUp)[0];
    throw new AgentGaveUpError(firstAgentToGiveUp);
  }

  // Check if all agents confirmed - if so, throw exception to stop experiment
  if (mailSystem.hasAllConfirmed()) {
    const meeting = mailSystem.getConfirmedMeeting();
    if (meeting) {
      return;
    }
  }

  // Check if agent gave up or confirmed
  if (mailSystem.givenUp.has(agentName) || mailSystem.confirmations.has(agentName)) {
    console.log(`${agentName}'s assistant concluded.`);
  }
}

// Main function
async function main() {
  const apiKey: string = process.env.OPENROUTER_API_KEY!;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  console.log('='.repeat(80));
  console.log('CHAT ROOM: Finding a Meeting Time');
  console.log('='.repeat(80));
  console.log('\nConstraints:');
  console.log('- Alice: does not want bar in the morning');
  console.log('- Bob: busy in the morning');
  console.log('- Carol: does not want bar');
  console.log('- Dave: flexible');
  console.log('\nStarting agents...\n');

  const mailSystem = new MailSystem();

  let shouldStop = false;

  // Check for conclusion periodically
  const checkInterval = setInterval(() => {
    if (mailSystem.hasAllConfirmed()) {
      const meeting = mailSystem.getConfirmedMeeting();
      if (meeting) {
        console.log('\n' + '='.repeat(80));
        console.log(`✅ SUCCESS! Meeting scheduled: ${meeting.place} at ${meeting.time}`);
        console.log('='.repeat(80));
        shouldStop = true;
        clearInterval(checkInterval);
      }
    }
    if (mailSystem.hasAnyoneGivenUp()) {
      console.log('\n' + '='.repeat(80));
      console.log('❌ FAILURE: An agent gave up');
      console.log('='.repeat(80));
      shouldStop = true;
      clearInterval(checkInterval);
    }
  }, 1000);

  // Run all agents concurrently
  const agents: AgentName[] = agentNameSchema.options as AgentName[];
  const agentPromises = agents.map(agent => runAgent(agent, mailSystem));

  try {
    await Promise.all(agentPromises);
  } catch (error) {
    clearInterval(checkInterval);

    // Handle AllAgentsConfirmedError - success, end experiment gracefully
    if (error instanceof AllAgentsConfirmedError) {
      console.log('\n' + '='.repeat(80));
      console.log(
        `✅ EXPERIMENT ENDED SUCCESSFULLY: ${error.meeting.place} at ${error.meeting.time}`,
      );
      console.log('='.repeat(80));
      // Don't re-throw, exit gracefully
      return;
    }

    // Handle AgentGaveUpError - this ends the experiment with error
    if (error instanceof AgentGaveUpError) {
      console.log('\n' + '='.repeat(80));
      console.log(`❌ EXPERIMENT ENDED: ${error.agent} gave up`);
      console.log('='.repeat(80));
      throw error; // Re-throw to exit with error
    }
    // Re-throw other errors
    throw error;
  } finally {
    clearInterval(checkInterval);
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total messages sent: ${mailSystem.getAllMessages().length}`);
  if (mailSystem.hasAllConfirmed()) {
    const meeting = mailSystem.getConfirmedMeeting();
    if (meeting) {
      console.log(`✅ Meeting confirmed: ${meeting.place} at ${meeting.time}`);
    } else {
      console.log('⚠️  All confirmed but with different options');
    }
  } else {
    console.log('❌ No meeting scheduled');
  }
  if (mailSystem.hasAnyoneGivenUp()) {
    console.log('❌ At least one agent gave up');
  }
}

main().catch(err => {
  // AllAgentsConfirmedError indicates success, don't treat it as an error
  if (err instanceof AllAgentsConfirmedError) {
    // Already handled in main(), exit successfully without printing error
    process.exit(0);
  }
  // AgentGaveUpError and other errors should be logged
  console.error(err);
  process.exit(1);
});
