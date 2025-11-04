import { type ZodType } from 'zod';
import { AtLeastOne, AtMostOne, NonEmptyArray } from './types.js';

/** The outermost type that characterizes the outcome of a tool call.
 */
export type ToolCallResult<InputType, OutputType> =
  | ToolCallSuccess<OutputType>
  | ToolCallFailure<InputType>;

/**
 * Accepted tool call.
 * Must contain ok: true, the rest of the fields, and (optionally) feedback and instructions.
 */
export type ToolCallSuccess<OutputType> = {
  ok: true;
} &
  // If OutputType is never, we don't allow value fields at all.
  ([OutputType] extends [never]
    ? {
        value?: never; // Explicitly disallow value property
      }
    : // If OutputType is Record<string, never> (empty object from z.object({})), treat it like never (we do not add any value fields)
      [OutputType] extends [Record<string, never>]
      ? {
          value?: never; // Explicitly disallow value property
        }
      : // If OutputType is a record, we use it directly
        OutputAsRecord<OutputType>) &
  FeedbackAndInstructions;

/**
 * If OutputType is a record, we use it directly.
 * Otherwise, we wrap it in a value field.
 */
export type OutputAsRecord<OutputType> = [OutputType] extends [Record<string, unknown>]
  ? OutputType
  : {
      value: OutputType;
    };

export type FeedbackAndInstructions = {
  /** Freeform feedback for the tool call. */
  feedback?: NonEmptyArray<string>;
  /** Freeform instructions for the agent in response to the tool call.
   * The developer may instruct the agent to follow these instructions via the system prompt,
   * or filter them out.
   */
  instructions?: NonEmptyArray<string>;
};

/**
 * Rejected tool call.
 * Since the goal of tool2agent is to let the LLM refine the input iteratively,
 * we require at least one actionable validation result to be present.
 * This requirement naturally guides the developer towards building better feedback systems,
 * because the type system will not allow omitting validation results.
 */
export type ToolCallFailure<InputType> = {
  ok: false;
} & FailureFeedback<InputType> &
  FeedbackAndInstructions;

export type FailureFeedback<InputType> =
  /** If InputType is a record, we can provide feedback for its fields. */
  InputType extends Record<string, unknown>
    ? /** We require at least one actionable validation result to be present. */
      RecordFailureFeedback<InputType>
    : /** If InputType is not a record, we provide feedback for the entire input.
       * In this case, `problems` field becomes required, and `validationResults` is not allowed,
       * because there is only a single field.
       * We do not include `requiresValidParameters` because it is not applicable to non-record inputs,
       * since it references other record fields.
       */
      ValueFailureFeedback<InputType>;

export type RecordFailureFeedback<InputType extends Record<string, unknown>> = AtLeastOne<{
  /**
   * not every parameter in the input type is required to be present,
   * but we require at least one to ensure the LLM can make some progress
   * on refining input.
   */
  validationResults: AtLeastOne<{
    [ParamKey in keyof InputType]?: ParameterValidationResult<InputType, ParamKey>;
  }>;
  problems: NonEmptyArray<string>;
}>;

export type ParameterValidationResult<
  InputType extends Record<string, unknown>,
  ParamKey extends keyof InputType,
> = CommonFailureFeedback<InputType[ParamKey]> &
  (
    | {
        valid: true;
      }
    | ({
        valid: false;
      } & ParameterValidationFailureReasons<InputType, ParamKey>)
  );

export type ValueFailureFeedback<InputType> = {
  problems: NonEmptyArray<string>;
} & CommonFailureFeedback<InputType>;

/**
 * Feedback for a single tool call parameter.
 */
export type CommonFailureFeedback<T> = {
  /** The tooling may normalize values to a canonical form */
  normalizedValue?: T;
  /**
   * The tooling may dynamically validate the parameter based on the context
   * This is useful for parameters whose shape is not statically known at design time
   */
  dynamicParameterSchema?: ZodType<T>;
} & AcceptableValues<T> &
  FeedbackAndInstructions;

/** Provides feedback that suggests acceptable values for the parameter. */
export type AcceptableValues<T> = AtMostOne<{
  /**
   * Exhaustive list of acceptable values.
   * Empty indicates that there are no options available.
   */
  allowedValues: T[];
  /** Non-exhaustive list of acceptable values */
  suggestedValues: NonEmptyArray<T>;
}>;

/** Refusal result for a single tool call input object field. Mandates at least one justification for the refusal. */
export type ParameterValidationFailureReasons<
  InputType extends Record<string, unknown>,
  ParamKey extends keyof InputType,
> = AtLeastOne<{
  /** Freeform reasons for why the parameter was not considered valid. */
  problems?: NonEmptyArray<string>;
  /**
   * Sometimes it is not possible to validate a parameter without knowing the values of other parameters.
   * In this case, the developer may specify the parameters that are required to validate this parameter,
   * excluding the parameter itself on the type level.
   */
  requiresValidParameters?: NonEmptyArray<Exclude<keyof InputType, ParamKey>>;
}>;
