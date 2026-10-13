import Notice from "@/components/auth/Notice";
import type { RailsActionState } from "@/app/operator/rails-actions";

/** The one line under a form saying what just happened. */
export default function ActionNotice({ state }: { state: RailsActionState }) {
  if (state.status === "error") return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "done") return <Notice tone="success">{state.message}</Notice>;
  return null;
}
