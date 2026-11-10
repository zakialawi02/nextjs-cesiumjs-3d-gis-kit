import { ErrorPage } from "@/components/error-page";

export default function Forbidden() {
  return <ErrorPage status={403} />;
}
