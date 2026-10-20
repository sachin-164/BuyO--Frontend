import { InfoPage } from "@/pages/info/info-page";

export default function ShippingPage() {
  return (
    <InfoPage
      title="Shipping"
      intro="Delivery coverage, charges, and timelines are not published yet. Rather than promise a delivery window the store cannot guarantee, this page explains what is already known and what the owner still needs to decide."
      draft
      sections={[
        {
          heading: "What is known today",
          body: (
            <>
              <p>
                A delivery address is collected and confirmed at checkout. Cash on delivery
                is offered as the payment option, and every order records its current status
                in your order history.
              </p>
              <p>
                Prices are shown in INR. Nothing on this page should be read as a delivery
                guarantee until the policy below is published.
              </p>
            </>
          ),
        },
        {
          heading: "Delivery areas and charges",
          body: (
            <p>
              Serviceable areas, delivery charges, free-delivery thresholds, and any
              cash-on-delivery limits have not been supplied. They will be listed here once
              the owner confirms them.
            </p>
          ),
        },
        {
          heading: "Dispatch and delivery timelines",
          body: (
            <p>
              Handling time, dispatch days, courier partners, and expected delivery windows
              are not published. Order statuses show progress, but they are not a promised
              arrival date.
            </p>
          ),
        },
        {
          heading: "If a delivery is late or missing",
          body: (
            <p>
              A dedicated escalation route has not been published yet. Until support channels
              are confirmed, the order details and status timeline in your account are the
              authoritative record of what was placed and how far it has progressed.
            </p>
          ),
        },
      ]}
      ownerInput={[
        "Serviceable areas or pin-code policy",
        "Delivery charges and free-delivery threshold",
        "Handling and dispatch times, including non-working days",
        "Courier partners and whether customers receive tracking links",
        "Procedure and contact route for late, lost, or damaged deliveries",
      ]}
    />
  );
}
