import { useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, MapPinPlus, Pencil, Star, Trash2 } from "lucide-react";
import { AddressFormDialog } from "@/components/commerce/address-form-dialog";
import { addressLines } from "@/components/commerce/address-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  useAddresses,
} from "@/features/addresses/queries";
import {
  useDeleteAddress,
  useSetDefaultAddress,
} from "@/features/addresses/mutations";
import { getErrorMessage } from "@/lib/errors";
import type { Address } from "@/types/account";

export default function AddressesPage() {
  const addressesQuery = useAddresses();
  const setDefault = useSetDefaultAddress();
  const deleteAddress = useDeleteAddress();
  const toast = useToast();

  const addresses = addressesQuery.data?.addresses ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [deletingAddress, setDeletingAddress] = useState<Address | null>(null);

  async function confirmDelete() {
    if (!deletingAddress) return;
    try {
      await deleteAddress.mutateAsync(deletingAddress.id);
      toast({
        tone: "success",
        title: "Address deleted",
        description: `${deletingAddress.fullName}'s address was removed from the address book.`,
      });
      setDeletingAddress(null);
    } catch (error) {
      toast({ tone: "error", title: "Could not delete address", description: getErrorMessage(error) });
      setDeletingAddress(null);
    }
  }

  async function handleSetDefault(address: Address) {
    try {
      await setDefault.mutateAsync(address.id);
      toast({
        tone: "success",
        title: "Default address updated",
        description: `${address.fullName}'s address is now used first at checkout.`,
      });
    } catch (error) {
      toast({ tone: "error", title: "Could not set default", description: getErrorMessage(error) });
    }
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Account
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Addresses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivery addresses are scoped to your account by the server.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditingAddress(null);
            setFormOpen(true);
          }}
        >
          <MapPinPlus aria-hidden="true" />
          Add address
        </Button>
      </div>

      {addressesQuery.isLoading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      ) : null}

      {addressesQuery.isError && !addressesQuery.isPending ? (
        <Alert variant="destructive" className="mt-8">
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
          className="mt-8"
          icon={MapPin}
          title="No addresses yet"
          description="Add a delivery address before checking out; it will be available to choose here and above the payment section."
          action={
            <Button
              type="button"
              onClick={() => {
                setEditingAddress(null);
                setFormOpen(true);
              }}
            >
              Add address
            </Button>
          }
        />
      ) : null}

      {addressesQuery.isSuccess && addresses.length > 0 ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex h-full flex-col rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">
                      {address.label?.trim() || address.fullName}
                    </h2>
                    {address.isDefault ? <Badge variant="success">Default</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{address.fullName}</p>
                </div>
                <MapPin className="size-5 shrink-0 text-primary" aria-hidden="true" />
              </div>

              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                {addressLines(address).map((line, index) => (
                  // Parsing a free-form address into discrete lines is safe for
                  // display; the APIs are authoritative and no matching data exists.
                  <li key={`${address.id}-${index}`} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>

              <footer className="mt-5 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingAddress(address);
                    setFormOpen(true);
                  }}
                  disabled={setDefault.isPending}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                {!address.isDefault ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleSetDefault(address)}
                    isLoading={setDefault.isPending && setDefault.variables === address.id}
                    disabled={setDefault.isPending}
                  >
                    <Star aria-hidden="true" />
                    Set default
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeletingAddress(address)}
                  disabled={deleteAddress.isPending}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              </footer>
            </li>
          ))}
        </ul>
      ) : null}

      <AddressFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingAddress(null);
        }}
        address={editingAddress}
      />

      <ConfirmDialog
        open={Boolean(deletingAddress)}
        onOpenChange={(open) => {
          if (!open) setDeletingAddress(null);
        }}
        tone="destructive"
        title="Delete this address?"
        description={`This permanently removes the saved address for ${deletingAddress?.fullName ?? "this person"}. Previous orders keep their own address snapshot.`}
        confirmLabel="Delete address"
        isPending={deleteAddress.isPending}
        onConfirm={() => void confirmDelete()}
      />

      <p className="mt-8 text-sm text-muted-foreground">
        <Link to="/account" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to account
        </Link>
      </p>
    </div>
  );
}
