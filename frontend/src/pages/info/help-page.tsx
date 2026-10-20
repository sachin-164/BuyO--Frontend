import { Link } from "react-router-dom";
import { InfoPage } from "@/pages/info/info-page";

const FAQS = [
  {
    question: "How do I place an order?",
    answer: (
      <>
        Add products to your cart, sign in, choose a delivery address, and confirm the order
        at checkout. Cash on delivery is the payment option currently offered. Your order
        then appears in your{" "}
        <Link to="/orders" className="font-medium text-primary underline underline-offset-2">
          order history
        </Link>
        .
      </>
    ),
  },
  {
    question: "Can I order without an account?",
    answer:
      "No. The cart, wishlist, addresses, and order history are all tied to an account, so signing in is required before checkout.",
  },
  {
    question: "Why is my email verification needed?",
    answer:
      "Verification confirms that the email address on the account belongs to you. Some account and checkout actions require a verified address. Use the verification link sent to the address you registered with.",
  },
  {
    question: "How do I follow my order?",
    answer: (
      <>
        Open{" "}
        <Link to="/orders" className="font-medium text-primary underline underline-offset-2">
          Orders
        </Link>{" "}
        and select the order. Its status timeline shows each status recorded by the store,
        from placement to delivery.
      </>
    ),
  },
  {
    question: "How does the wishlist work?",
    answer:
      "Saved products are stored with your account, so they survive signing in on another device. Saving a product does not reserve stock, and the price can change before you order.",
  },
  {
    question: "What happens if a product runs out of stock?",
    answer:
      "Products that are out of stock cannot be added to the cart. If stock changes while an item is in your cart or while you are checking out, the store reports the conflict instead of silently changing your order.",
  },
  {
    question: "How do I get help with an order?",
    answer: (
      <>
        Start from your{" "}
        <Link to="/account" className="font-medium text-primary underline underline-offset-2">
          account
        </Link>{" "}
        and the relevant order. Public support channels are not published yet; the{" "}
        <Link to="/contact" className="font-medium text-primary underline underline-offset-2">
          Contact page
        </Link>{" "}
        lists what is still required from the owner.
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <InfoPage
      title="Help & FAQ"
      intro="Straight answers about how the store works today. Where a policy has not been decided, it is marked as owner input instead of being guessed."
      sections={[
        {
          heading: "Frequently asked questions",
          body: (
            <dl className="space-y-6">
              {FAQS.map((item) => (
                <div key={item.question}>
                  <dt className="font-semibold text-foreground">{item.question}</dt>
                  <dd className="mt-1.5">{item.answer}</dd>
                </div>
              ))}
            </dl>
          ),
        },
      ]}
      ownerInput={[
        "Support hours and the best public contact route",
        "Order cancellation rules and cut-off point",
        "Cash-on-delivery limits or extra charges",
        "What customers should do if a delivery is late or missing",
      ]}
    />
  );
}
