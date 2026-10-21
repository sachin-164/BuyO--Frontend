import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Banknote,
  CircleAlert,
  MapPinPlus,
  Pencil,
  ShoppingBag,
} from "lucide-react";
import { AddressFormDialog } from "@/components/commerce/address-form-dialog";
import { OrderSummary } from "@/components/commerce/order-summary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/form-field";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCart } from "@/features/cart/queries";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAddresses } from "@/features/addresses/queries";
import { useCreateOrder } from "@/features/orders/mutations";
import { getApiErrorDetails, getErrorMessage } from "@/lib/errors";
import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import type { Address } from "@/types/account";
import type { CheckoutConflict } from "@/types/commerce";

function AddressRadio({
  address,
  checked,
  onChange,
  onEdit,
}: {
  address: Address;
  checked: boolean;
  onChange: () => void;
  onEdit: () => void;
}) {
  return (
    <label
      className={cn(
        "flex h-full cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors",
        checked
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-3">
          <input
            type="radio"
            name="checkout-address"
            value={address.id}
            checked={checked}
            onChange={onChange}
            className="mt-1 size-4 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {address.label?.trim() || address.fullName}
              </span>
              {address.isDefault ? <Badge variant="success">Default</Badge> : null}
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
            </span>
            <span className="block text-sm text-muted-foreground">
              {address.city}, {address.state} {address.pincode}
            </span>
            <span className="block text-sm text-muted-foreground">
              {address.fullName} · {address.phone}
            </span>
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.preventDefault();
            onEdit();
          }}
        >
          <Pencil aria-hidden="true" />
          <span className="sr-only">Edit {address.label?.trim() || address.fullName}</span>
        </Button>
      </span>
    </label>
  );
}

export default function CheckoutPage() {
  usePageTitle("Checkout");
  const cartQuery = useCart();
  const addressesQuery = useAddresses();
  const createOrder = useCreateOrder();
  const navigate = useNavigate();
  const toast = useToast();

  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [notes, setNotes] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<CheckoutConflict[] | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  if (!idempotencyKeyRef.current) {
    idempotencyKeyRef.current = getCheckoutIdempotencyKey();
  }
  const placingRef = useRef(false);

  const cart = cartQuery.data;
  const addresses = addressesQuery.data?.addresses ?? [];
  const selectedAddress = addresses.find((address) => address.id === selectedAddressId) ?? null;

  useEffect(() => {
    if (addressesQuery.isSuccess && addresses.length > 0) {
      setSelectedAddressId((current) => {
        if (current && addresses.some((address) => address.id === current)) return current;
        const fallback = addresses.find((address) => address.isDefault) ?? addresses[0];
        return fallback?.id ?? null;
      });
    }
  }, [addressesQuery.isSuccess, addresses]);

  const stockProblem =
    Boolean(cart?.items.some((item) => !item.unavailable && item.stockExceeded)) ||
    Boolean(cart?.items.some((item) => item.unavailable));
  const canAttemptOrder =
    Boolean(cart && cart.items.length > 0) &&
    Boolean(selectedAddress) &&
    !stockProblem &&
    !createOrder.isPending;

  function handlePlaceOrder() {
    if (placingRef.current || !canAttemptOrder || !selectedAddress) return;
    placingRef.current = true;
    setServerError(null);
    setConflicts(null);

    createOrder.mutate(
      {
        addressId: selectedAddress.id,
        idempotencyKey: idempotencyKeyRef.current as string,
        notes: notes.trim() ? notes.trim() : undefined,
      },
      {
        onSuccess: (response) => {
          placingRef.current = false;
          // The key is consumed whether this is the original order or a replay.
          clearCheckoutIdempotencyKey();
          toast({
            tone: response.idempotentReplay ? "info" : "success",
            title: response.idempotentReplay
              ? "Order already placed"
              : "Order placed",
            description: response.idempotentReplay
              ? "A retry with the same idempotency key was already accepted by the server."
              : `${response.order.orderNumber} is ready for confirmation.`,
          });
          navigate(`/checkout/confirmation/${response.order.id}`, {
            replace: true,
            state: { justPlaced: !response.idempotentReplay },
          });
        },
        onError: (error) => {
          placingRef.current = false;
          const conflictDetails =
            getApiErrorDetails<{ errors?: CheckoutConflict[] }>(error)?.errors;
          const conflictList = Array.isArray(conflictDetails) ? conflictDetails : null;
          setConflicts(conflictList);
          if (!conflictList) setServerError(getErrorMessage(error));
        },
      },
    );
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Checkout
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Review and place order</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cash on delivery only. The server re-validates your cart and recomputes totals.
        </p>
      </header>

      {cartQuery.isLoading || addressesQuery.isLoading ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-[2fr,1fr] sm:items-start" aria-busy="true">
          <div className="space-y-4">
            <Skeleton className="h-44 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : null}

      {cartQuery.isSuccess && cart && cart.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={ShoppingBag}
            title="Your cart is empty"
            description="Add products before returning to checkout."
            action={
              <Button asChild>
                <Link to="/shop">Browse products</Link>
              </Button>
            }
          />
        </div>
      ) : null}

      {cartQuery.isSuccess && cart && cart.items.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-[2fr,1fr] sm:items-start">
          <div className="space-y-6">
            <section aria-labelledby="delivery-address-heading">
              <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle id="delivery-address-heading">Delivery address</CardTitle>
                    <p className="mt-2 text-sm text-muted-foreground">
                      The server only accepts an address you own.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditingAddress(null);
                      setAddressDialogOpen(true);
                    }}
                  >
                    <MapPinPlus aria-hidden="true" />
                    Add
                  </Button>
                </CardHeader>
                <CardContent>
                  {addressesQuery.isError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Addresses could not be loaded</AlertTitle>
                      <AlertDescription>{getErrorMessage(addressesQuery.error)}</AlertDescription>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() => void addressesQuery.refetch()}
                      >
                        Try again
                      </Button>
                    </Alert>
                  ) : null}

                  {addressesQuery.isSuccess && addresses.length === 0 ? (
                    <EmptyState
                      icon={ShoppingBag}
                      className="border-dashed p-6"
                      title="No delivery address yet"
                      description="Add the delivery address you want this order shipped to."
                      action={
                        <Button
                          type="button"
                          onClick={() => {
                            setEditingAddress(null);
                            setAddressDialogOpen(true);
                          }}
                        >
                          Add delivery address
                        </Button>
                      }
                    />
                  ) : null}

                  {addresses.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {addresses.map((address) => (
                        <AddressRadio
                          key={address.id}
                          address={address}
                          checked={Boolean(selectedAddress && selectedAddress.id === address.id)}
                          onChange={() => setSelectedAddressId(address.id)}
                          onEdit={() => {
                            setEditingAddress(address);
                            setAddressDialogOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="payment-heading">
              <Card>
                <CardHeader>
                  <CardTitle id="payment-heading">Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3 rounded-md border border-border bg-secondary/40 p-4">
                    <Banknote className="mt-0.5 size-5 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium">Cash on delivery</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Pay cash when your order is delivered. No payment details are collected in
                        this storefront.
                      </p>
                    </div>
                  </div>

                  <Field
                    id="checkout-notes"
                    label="Delivery notes"
                    optional
                    hint="Used by the packer and delivery partner. Maximum 500 characters."
                    error={notes.length > 500 ? "Notes must be 500 characters or fewer." : undefined}
                  >
                    <Textarea
                      id="checkout-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      maxLength={500}
                      placeholder="Gate code, calling instructions, or a package instruction"
                      aria-invalid={notes.length > 500}
                      aria-describedby="checkout-notes-hint"
                    />
                  </Field>
                  <p className="text-right text-xs text-muted-foreground">
                    {notes.length}/500 characters
                  </p>
                </CardContent>
              </Card>
            </section>
          </div>

          <div className="space-y-4">
            <OrderSummary
              totals={cart.totals}
              itemCount={cart.count}
              totalsNotice={cart.totalsNotice}
            />

            {serverError ? (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>Order could not be placed</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            {conflicts ? (
              <Alert variant="warning">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>Some items changed</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 space-y-1">
                    {conflicts.map((conflict, index) => (
                      <li key={`${conflict.productId ?? conflict.name}-${index}`}>
                        {conflict.name}: {conflict.reason} (requested {conflict.requested}, available {conflict.available})
                      </li>
                    ))}
                  </ul>
                  <Link to="/cart" className="mt-2 inline-block font-medium underline underline-offset-4">
                    Review your cart
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}

            {stockProblem ? (
              <Alert variant="warning">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>Cart not valid for checkout</AlertTitle>
                <AlertDescription>
                  Remove unavailable items and align quantities with live stock.
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={handlePlaceOrder}
              disabled={!canAttemptOrder || notes.length > 500}
              isLoading={createOrder.isPending}
            >
              Place COD order
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Retries reuse the same idempotency key until the order is accepted.
            </p>
          </div>
        </div>
      ) : null}

      {cartQuery.isError && !cartQuery.isPending ? (
        <Alert variant="destructive" className="mt-8">
          <ShoppingBag aria-hidden="true" />
          <AlertTitle>Cart could not be loaded</AlertTitle>
          <AlertDescription>{getErrorMessage(cartQuery.error)}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void cartQuery.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : null}

      <AddressFormDialog
        open={addressDialogOpen}
        onOpenChange={setAddressDialogOpen}
        address={editingAddress}
        onSaved={(saved) => setSelectedAddressId(saved.id)}
      />
    </div>
  );
}
