import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Business details must come from the owner. This notice is deliberately
 * visible so a draft page can never be mistaken for a published policy.
 */
export function OwnerInputNotice({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Owner input required</AlertTitle>
      <AlertDescription>
        <p>The following details are not published yet and must be supplied before launch:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
