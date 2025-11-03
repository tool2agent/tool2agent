import { type ZodType } from 'zod';
import { AtLeastOne, AtMostOne, NonEmptyArray } from './types.js';

/** The outermost type that characterizes the outcome of a tool call.
 */
export type ToolCallResult<InputType, OutputType> =
  | ToolCallAccepted<OutputType>
  | ToolCallRejected<InputType>;

/**
 * Accepted tool call.
 * Must contain ok: true, the rest of the fields, and (optionally) feedback and instructions.
 */
export type ToolCallAccepted<OutputType> = {
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
      : // If OutputType is {} (plain empty object), treat it like never
        [OutputType] extends [{}]
        ? // If OutputType has keys, use it directly (i.e. object keys are placed alongside ok:true)
          FlattenOrWrapInValueField<OutputType>
        : // If OutputType is a record, we use it directly
          FlattenOrWrapInValueField<OutputType>) &
  FreeFormFeedback;

/**
 * If T is a record, we use it directly.
 * Otherwise, we wrap it in a value field.
 */
type FlattenOrWrapInValueField<T> = [T] extends [Record<string, unknown>]
  ? T
  : {
      value: T;
    };

export type FreeFormFeedback = {
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
export type ToolCallRejected<InputType> = {
  ok: false;
} & TypedParametersFeedback<InputType> &
  FreeFormFeedback;

export type TypedParametersFeedback<InputType> =
  /** If InputType is a record, we can provide feedback for its fields. */
  InputType extends Record<string, unknown>
    ? /** We require at least one actionable validation result to be present. */
      AtLeastOne<{
        /**
         * not every parameter in the input type is required to be present,
         * but we require at least one to ensure the LLM can make some progress
         * on refining input.
         */
        validationResults: AtLeastOne<{
          [ParamKey in keyof InputType]?: ParameterFeedback<InputType, ParamKey>;
        }>;
        problems: NonEmptyArray<string>;
      }>
    : /** If InputType is not a record, we provide feedback for the entire input.
       * In this case, `problems` field becomes required, and `validationResults` is not allowed,
       * because there is only a single field.
       * We do not include `requiresValidParameters` because it is not applicable to non-record inputs,
       * since it references other record fields.
       */
      SingleParameterFeedback<InputType>;

export type ParameterFeedback<
  InputType extends Record<string, unknown>,
  ParamKey extends keyof InputType,
> = ParameterFeedbackCommon<InputType[ParamKey]> & ParameterFeedbackVariants<InputType, ParamKey>;

export type SingleParameterFeedback<InputType> = {
  problems: NonEmptyArray<string>;
} & ParameterFeedbackCommon<InputType>;

/**
 * Feedback for a single tool call parameter.
 */
export type ParameterFeedbackCommon<T> = {
  /** The tooling may normalize values to a canonical form */
  normalizedValue?: T;
  /**
   * The tooling may dynamically validate the parameter based on the context
   * This is useful for parameters whose shape is not statically known at design time
   */
  dynamicParameterSchema?: ZodType<T>;
} & AcceptableValues<T> &
  FreeFormFeedback;

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

/** Validation result for a single tool call input object field. */
export type ParameterFeedbackVariants<
  InputType extends Record<string, unknown>,
  ParamKey extends keyof InputType,
> =
  | {
      valid: true;
    }
  | ({
      valid: false;
    } & ParameterFeedbackRefusal<InputType, ParamKey>);

/** Refusal result for a single tool call input object field. Mandates at least one justification for the refusal. */
export type ParameterFeedbackRefusal<
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
