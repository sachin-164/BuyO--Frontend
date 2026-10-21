import { AddressForm } from "@/components/commerce/address-form";
import { Modal } from "@/components/ui/modal";
import type { Address } from "@/types/account";

interface AddressFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address?: Address | null;
  onSaved?: (address: Address) => void;
}

export function AddressFormDialog({
  open,
  onOpenChange,
  address,
  onSaved,
}: AddressFormDialogProps) {
  const editing = Boolean(address);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit address" : "Add delivery address"}
      description={
        editing
          ? "Update saved fields. The server validates formats."
          : "Add a delivery address for your orders."
      }
      className="max-w-xl"
    >
      <AddressForm
        address={address}
        submitLabel={editing ? "Save changes" : "Save address"}
        onCancel={() => onOpenChange(false)}
        onSaved={(changed) => {
          onOpenChange(false);
          onSaved?.(changed);
        }}
      />
    </Modal>
  );
}
