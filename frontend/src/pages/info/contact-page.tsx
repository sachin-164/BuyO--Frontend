import { Link } from "react-router-dom";
import { InfoPage } from "@/pages/info/info-page";

export default function ContactPage() {
  return (
    <InfoPage
      title="Contact"
      intro="Support channels are not published yet. To avoid sending you to an email address or phone number that does not exist, this page only lists the routes that work today."
      sections={[
        {
          heading: "Order and account help",
          body: (
            <>
              <p>
                Sign in and open your{" "}
                <Link to="/orders" className="font-medium text-primary underline underline-offset-2">
                  order history
                </Link>{" "}
                to see item lines, totals, the delivery address, and the latest status for
                each order.
              </p>
              <p>
                Account details are available from{" "}
                <Link to="/account" className="font-medium text-primary underline underline-offset-2">
                  your account
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          heading: "Sign-in and verification help",
          body: (
            <p>
              If you cannot sign in, use the password-reset link on the sign-in page. Account
              verification links are sent by email when an account is created. Check the
              address you registered with before assuming the link is missing.
            </p>
          ),
        },
        {
          heading: "Contact form availability",
          body: (
            <p>
              There is no contact form on this site yet, because no support inbox or
              ticketing endpoint has been configured. A form will not be added until messages
              have somewhere real to go.
            </p>
          ),
        },
        {
          heading: "Support details still needed",
          body: (
            <p>
              The support email address, phone number, opening hours, expected response time,
              and business address have not been supplied. They are listed below as owner
              input rather than guessed.
            </p>
          ),
        },
      ]}
      ownerInput={[
        "Support email address and whether it is monitored",
        "Support phone number and opening hours",
        "Expected first-response time",
        "Business or registered address, if it should be public",
        "Escalation route for damaged or missing orders",
      ]}
    />
  );
}
