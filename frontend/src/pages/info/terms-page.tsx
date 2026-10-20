import { InfoPage } from "@/pages/info/info-page";

export default function TermsPage() {
  return (
    <InfoPage
      title="Terms"
      intro="The store's terms are not final. This page is a placeholder that describes how the service behaves today; it is not a contract and should not be relied on as one."
      draft
      sections={[
        {
          heading: "What the store currently does",
          body: (
            <>
              <p>
                An account is required to use the cart, wishlist, addresses, and checkout.
                Prices are displayed in INR, and stock is checked when items are added and
                again when an order is placed. Cash on delivery is offered as the payment
                option at checkout.
              </p>
              <p>
                Order statuses are recorded in your account. They describe progress, not a
                guaranteed delivery date.
              </p>
            </>
          ),
        },
        {
          heading: "Account responsibilities",
          body: (
            <p>
              Keep your password and email account secure, use accurate delivery details, and
              do not attempt to disrupt the service or access another person's account. If you
              believe your account has been compromised, use the password-reset flow and
              contact support once a public channel is published.
            </p>
          ),
        },
        {
          heading: "Terms still to be written",
          body: (
            <p>
              Cancellation rules, liability, warranties, intellectual property, governing law,
              dispute resolution, and how changes to these terms are announced have not been
              supplied. No jurisdiction or legal policy is implied by this draft.
            </p>
          ),
        },
      ]}
      ownerInput={[
        "Legal entity, jurisdiction, and governing law",
        "Order cancellation and refusal rules",
        "Liability limits, disclaimers, and warranties",
        "Intellectual property and acceptable-use clauses",
        "Dispute-resolution and consumer-rights language",
        "How and when changes to the terms are notified",
        "Lawyer review of the final terms",
      ]}
    />
  );
}
