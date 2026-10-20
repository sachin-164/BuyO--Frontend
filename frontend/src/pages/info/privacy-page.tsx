import { InfoPage } from "@/pages/info/info-page";

export default function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy"
      intro="A plain-language draft of what the store stores and why. It is not legal advice, and it has not been reviewed by a lawyer or finalised by the owner."
      draft
      sections={[
        {
          heading: "Data the store uses",
          body: (
            <>
              <p>When you create an account or place an order, the store records:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Your name, email address, and email-verification state.</li>
                <li>Your password, stored only as a bcrypt hash — never as plain text.</li>
                <li>Delivery addresses you save or use at checkout.</li>
                <li>Your cart, wishlist, and order history, including item lines and totals.</li>
              </ul>
              <p>
                Your browser stores a sign-in token so the session survives a page reload.
                Recent search terms are also kept in local browser storage and can be cleared
                from the search page; they are not sent to the store as a search history.
              </p>
            </>
          ),
        },
        {
          heading: "Why it is used",
          body: (
            <p>
              This data is used to operate your account, keep the cart and wishlist working,
              place and track orders, send verification and password-reset email, and protect
              the service from misuse. Any additional use — such as marketing — must be
              documented here before it is introduced.
            </p>
          ),
        },
        {
          heading: "Where it runs",
          body: (
            <p>
              The application is hosted on Vercel, uses Supabase for its PostgreSQL database
              and product image storage, and sends transactional email through the email
              provider configured for the store. These providers process data on the store's
              behalf.
            </p>
          ),
        },
        {
          heading: "Your choices and gaps",
          body: (
            <>
              <p>
                You can clear recent searches from the search page and clear the sign-in token
                by signing out or clearing browser storage. A self-service data export or
                account-deletion flow is not available yet.
              </p>
              <p>
                Retention periods, the privacy contact, cookie or analytics use, and the legal
                basis for processing have not been documented. They must be added, with legal
                review, before this page is treated as a final privacy notice.
              </p>
            </>
          ),
        },
      ]}
      ownerInput={[
        "Legal entity responsible for the data and a privacy contact",
        "Retention periods for accounts, orders, and support records",
        "Cookie, analytics, and marketing practices (including none, if that is the case)",
        "Account deletion and data-export process",
        "Applicable privacy law and jurisdiction",
        "Lawyer review of the final notice",
      ]}
    />
  );
}
