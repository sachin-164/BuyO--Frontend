import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Heart,
  Menu,
  Search,
  ShoppingBag,
  UserRound,
  X,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { SearchCombobox } from "@/components/catalog/search-combobox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/shop", label: "Shop" },
  { to: "/categories", label: "Categories" },
  { to: "/services", label: "Services" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary hover:text-secondary-foreground",
    isActive ? "bg-secondary text-primary" : "text-foreground/80",
  );
}

const iconLinkClass =
  "inline-flex size-10 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-secondary hover:text-primary";

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container-page flex h-16 items-center gap-3 sm:gap-4">
        <Link
          to="/"
          className="flex shrink-0 items-center font-display text-2xl font-bold tracking-tight"
          aria-label="BuyO home"
        >
          BuyO<span className="text-accent" aria-hidden="true">.</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto hidden w-full max-w-xs lg:block">
          <SearchCombobox />
        </div>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Link to="/wishlist" aria-label="Wishlist" className={iconLinkClass}>
            <Heart className="size-5" aria-hidden="true" />
          </Link>
          <Link to="/cart" aria-label="Cart" className={iconLinkClass}>
            <ShoppingBag className="size-5" aria-hidden="true" />
          </Link>
          <Link
            to="/account"
            aria-label="Account"
            className={cn(iconLinkClass, "hidden sm:inline-flex")}
          >
            <UserRound className="size-5" aria-hidden="true" />
          </Link>

          <Dialog.Root open={searchOpen} onOpenChange={setSearchOpen}>
            <Dialog.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open search"
              >
                <Search aria-hidden="true" />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in lg:hidden" />
              <Dialog.Content className="fixed inset-x-3 top-20 z-50 rounded-lg border border-border bg-background p-4 shadow-lg animate-dialog-in lg:hidden">
                <div className="mb-3 flex items-center justify-between">
                  <Dialog.Title className="font-display text-lg">Search</Dialog.Title>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close search">
                      <X aria-hidden="true" />
                    </Button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Search the catalog for products by name or category.
                </Dialog.Description>
                <SearchCombobox
                  size="large"
                  onNavigate={() => setSearchOpen(false)}
                />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open menu"
              >
                <Menu aria-hidden="true" />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in md:hidden" />
              <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(20rem,85vw)] border-l border-border bg-background p-6 shadow-lg animate-slide-in-right md:hidden">
                <div className="flex items-center justify-between">
                  <Dialog.Title className="font-display text-xl">Menu</Dialog.Title>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close menu">
                      <X aria-hidden="true" />
                    </Button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Store navigation; use the search button in the header to search products.
                </Dialog.Description>

                <nav aria-label="Mobile" className="mt-6 flex flex-col gap-1">
                  {NAV_ITEMS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={navLinkClass}
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>

                <div className="mt-6 flex flex-col gap-1 border-t border-border pt-6">
                  <NavLink
                    to="/account"
                    className={navLinkClass}
                    onClick={() => setMenuOpen(false)}
                  >
                    Account
                  </NavLink>
                  <NavLink
                    to="/wishlist"
                    className={navLinkClass}
                    onClick={() => setMenuOpen(false)}
                  >
                    Wishlist
                  </NavLink>
                  <NavLink
                    to="/cart"
                    className={navLinkClass}
                    onClick={() => setMenuOpen(false)}
                  >
                    Cart
                  </NavLink>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
