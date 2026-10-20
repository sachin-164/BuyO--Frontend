import { Link } from "react-router-dom";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      { to: "/shop", label: "All products" },
      { to: "/categories", label: "Categories" },
      { to: "/search", label: "Search" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/about", label: "About BuyO" },
      { to: "/services", label: "Services" },
      { to: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Support",
    links: [
      { to: "/help", label: "Help & FAQ" },
      { to: "/shipping", label: "Shipping" },
      { to: "/returns", label: "Returns" },
    ],
  },
  {
    title: "Account",
    links: [
      { to: "/account", label: "Your account" },
      { to: "/orders", label: "Orders" },
      { to: "/wishlist", label: "Wishlist" },
    ],
  },
];

const LEGAL_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/10 bg-primary text-primary-foreground">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Link to="/" className="font-display text-2xl font-bold tracking-tight">
            BuyO<span className="text-accent" aria-hidden="true">.</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-primary-foreground/75">
            A focused marketplace for everyday goods. Cash on delivery, saved
            wishlists, and orders you can track.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-primary-foreground">
              {column.title}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm text-primary-foreground/75 transition-colors hover:text-primary-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-3 py-5 text-xs text-primary-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} BuyO. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="transition-colors hover:text-primary-foreground"
              >
                {link.label}
              </Link>
            ))}
            <p>Prices in INR. Cash on delivery available at checkout.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
