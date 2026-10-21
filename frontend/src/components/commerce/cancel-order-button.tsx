import { useState } from "react";
import type { ComponentProps } from "react";
import { Ban } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useCancelOrder } from "@/features/orders/mutations";
import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

interface CancelOrderButtonProps {
  orderId: number;
  orderNumber: string;
  size?: ComponentProps<typeof Button>["size"];
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
}

/**
 * Confirmed, server-authoritative order cancellation.
 *
 * The button is only rendered when the API says the order is cancellable
 * (`canCancel`), but eligibility is still re-checked on the server under a row
 * lock. A 409 therefore means "the order moved on while this dialog was open";
 * the dialog closes and the invalidated queries re-render the real status
 * instead of pretending the cancel succeeded.
 */
export function CancelOrderButton({
  orderId,
  orderNumber,
  size = "sm",
  variant = "outline",
  className,
}: CancelOrderButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelOrder = useCancelOrder();
  const toast = useToast();

  async function handleConfirm() {
    setError(null);
    try {
      await cancelOrder.mutateAsync(orderId);
      setOpen(false);
      toast({
        title: "Order cancelled",
        description: `${orderNumber} was cancelled and its items were returned to stock.`,
        tone: "success",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setOpen(false);
        toast({
          title: "This order can no longer be cancelled",
          description: "It was updated in the meantime. The latest status is shown below.",
          tone: "info",
        });
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setOpen(false);
        toast({
          title: "Order not found",
          description: "This order is not in your account.",
          tone: "error",
        });
        return;
      }
      setError(getErrorMessage(err));
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Ban aria-hidden="true" />
        Cancel order
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!cancelOrder.isPending) setOpen(next);
        }}
        title={`Cancel order ${orderNumber}?`}
        description="This changes the order status to cancelled and returns every item to stock."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={cancelOrder.isPending}
            >
              Keep order
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirm()}
              isLoading={cancelOrder.isPending}
            >
              Cancel order
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This cannot be undone from the browser. Because this order is Cash on Delivery, no
            payment has been collected.
          </p>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>The order could not be cancelled</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
