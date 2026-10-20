import { Link } from "react-router-dom";
import { InfoPage } from "@/pages/info/info-page";

export default function AboutPage() {
  return (
    <InfoPage
      title="About BuyO"
      intro="BuyO is a focused marketplace for everyday goods. This page is being written carefully: rather than invent a founding story or company details, anything the owner has not supplied yet is marked clearly."
      sections={[
        {
          heading: "What the store does today",
          body: (
            <>
              <p>
                The catalog shows live product prices and stock. You can search it, filter
                by category, save products to an account-backed wishlist, and place an order
                with cash on delivery.
              </p>
              <p>
                Orders are tied to your account, with a status timeline you can follow from
                placement through delivery. Prices are shown in INR.
              </p>
            </>
          ),
        },
        {
          heading: "How the catalog works",
          body: (
            <>
              <p>
                Products belong to categories, and each product page shows its current stock.
                Products that are out of stock cannot be added to the cart, and stock is
                checked again when an order is placed.
              </p>
              <p>
                Browse the <Link to="/shop" className="font-medium text-primary underline underline-offset-2">full catalog</Link>{" "}
                or start from a{" "}
                <Link to="/categories" className="font-medium text-primary underline underline-offset-2">
                  category
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          heading: "Company details",
          body: (
            <p>
              The founding story, legal business name, registered address, team, and any
              brand claims have not been supplied for publication. They will be added here
              only after the owner verifies them.
            </p>
          ),
        },
      ]}
      ownerInput={[
        "Founding story and mission statement",
        "Legal business name and registered address",
        "Team or owner details that should be public",
        "Certifications, awards, or sourcing claims (only if verifiable)",
        "A public contact route for press or partnership enquiries",
      ]}
    />
  );
}
