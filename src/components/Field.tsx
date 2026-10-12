import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { InlineMessage } from "@/components/InlineMessage";

// A form field whose label is programmatically tied to its control, so screen readers announce what
// each input is for and tapping the label focuses the input. The control is found inside the children
// (it may be wrapped, for example in a currency prefix box) and receives the generated id.
//
// Optional `help` and `error` props render a hint and a validation message below the control and wire
// them to it with `aria-describedby` (and `aria-invalid` for errors). Without them the output is
// exactly what it was before.
const CONTROLS = new Set(["input", "select", "textarea"]);

type ControlProps = { id?: string; children?: ReactNode; "aria-describedby"?: string };
type Describe = { help: boolean; error: boolean };

function attach(node: ReactNode, id: string, state: { done: boolean; id: string }, describe: Describe): ReactNode {
  return Children.map(node, (child) => {
    if (state.done || !isValidElement(child)) return child;
    const element = child as ReactElement<ControlProps>;
    if (typeof element.type === "string" && CONTROLS.has(element.type)) {
      state.done = true;
      state.id = element.props.id ?? id;
      const props: Record<string, unknown> = element.props.id ? {} : { id };
      if (describe.help || describe.error) {
        props["aria-describedby"] = [
          element.props["aria-describedby"],
          describe.help ? state.id + "-help" : "",
          describe.error ? state.id + "-error" : ""
        ].filter(Boolean).join(" ");
        if (describe.error) props["aria-invalid"] = true;
      }
      return Object.keys(props).length ? cloneElement(element, props as Partial<ControlProps>) : element;
    }
    if (element.props.children !== undefined) {
      const inner = attach(element.props.children, id, state, describe);
      return state.done ? cloneElement(element, undefined, inner) : element;
    }
    return element;
  });
}

function present(value: ReactNode) {
  return value !== undefined && value !== null && value !== false && value !== "";
}

export function Field({ className = "field", label, children, help, error }: {
  className?: string;
  label: ReactNode;
  children: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
}) {
  const generated = useId();
  const state = { done: false, id: generated };
  const hasHelp = present(help);
  const hasError = present(error);
  const content = attach(children, generated, state, { help: hasHelp, error: hasError });
  return <div className={className}>
    <label htmlFor={state.id}>{label}</label>
    {content}
    {hasHelp && <div className="help" id={state.id + "-help"}>{help}</div>}
    {hasError && <InlineMessage tone="error" id={state.id + "-error"}>{error}</InlineMessage>}
  </div>;
}
