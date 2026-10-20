import { Link } from "react-router-dom";
import { InfoPage } from "@/pages/info/info-page";

export default function ServicesPage() {
  return (
    <InfoPage
      title="Services"
      intro="These are the services that exist in BuyO today. Delivery coverage, charges, and after-sales services are not published yet and are marked as owner input."
      sections={[
        {
          heading: "Cash on delivery",
          body: (
            <p>
              Cash on delivery is offered as a payment option at checkout. No card details
              are stored by the storefront. The order total shown at checkout is the amount
              recorded against the order.
            </p>
          ),
        },
        {
          heading: "Order tracking",
          body: (
            <p>
              Every order has a status timeline in your{" "}
              <Link to="/orders" className="font-medium text-primary underline underline-offset-2">
                order history
              </Link>
              , from placement through delivery. The timeline reflects the status recorded by
              the store; it is not a courier tracking feed unless one is added later.
            </p>
          ),
        },
        {
          heading: "Wishlist and saved products",
          body: (
            <p>
              Your wishlist is tied to your account, not to a single browser, so it is
              available after signing in on another device. Saving a product does not reserve
              stock.
            </p>
          ),
        },
        {
          heading: "Catalog and stock checks",
          body: (
            <p>
              Product pages show current stock. Out-of-stock products cannot be added to the
              cart, and stock is checked again when an order is placed. If stock changes while
              you are shopping, the cart or checkout will report the conflict rather than
              silently changing the quantity.
            </p>
          ),
        },
      ]}
      ownerInput={[
        "Delivery areas and any serviceable pin codes",
        "Delivery charges, free-delivery thresholds, and COD limits",
        "Dispatch and handling times",
        "Courier partners, if customers should see them",
        "Installation, warranty, or after-sales services (only if offered)",
        "Return, exchange, and refund services (see the Returns page)",
      ]}
    />
  );
}
