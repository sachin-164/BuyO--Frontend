import { Suspense, lazy, type ReactNode } from "react";
import {
  Navigate,
  createBrowserRouter,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { StorefrontLayout } from "@/components/layout/storefront-layout";
import { Spinner } from "@/components/ui/spinner";
import AdminPlaceholderPage from "@/pages/admin-placeholder-page";
import ComingSoonPage from "@/pages/coming-soon-page";
import NotFoundPage from "@/pages/not-found-page";
import RouteErrorPage from "@/pages/route-error-page";

const HomePage = lazy(() => import("@/pages/home-page"));
const ShopPage = lazy(() => import("@/pages/shop-page"));
const SearchPage = lazy(() => import("@/pages/search-page"));
const ProductPage = lazy(() => import("@/pages/product-page"));
const CategoriesPage = lazy(() => import("@/pages/categories-page"));
const AboutPage = lazy(() => import("@/pages/info/about-page"));
const ContactPage = lazy(() => import("@/pages/info/contact-page"));
const ServicesPage = lazy(() => import("@/pages/info/services-page"));
const HelpPage = lazy(() => import("@/pages/info/help-page"));
const ShippingPage = lazy(() => import("@/pages/info/shipping-page"));
const ReturnsPage = lazy(() => import("@/pages/info/returns-page"));
const PrivacyPage = lazy(() => import("@/pages/info/privacy-page"));
const TermsPage = lazy(() => import("@/pages/info/terms-page"));

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label="Loading page" />
    </div>
  );
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

function LegacyRedirect({ to, keepSearch = false }: { to: string; keepSearch?: boolean }) {
  const location = useLocation();
  return <Navigate to={keepSearch ? `${to}${location.search}` : to} replace />;
}

/** `/categories/:slug` keeps old-style category links working. */
function LegacyCategoryRedirect() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <Navigate
      to={slug ? `/shop?category=${encodeURIComponent(slug)}` : "/categories"}
      replace
    />
  );
}

/** The legacy detail page used `?id=`; the API accepts an id or a slug. */
function LegacyProductRedirect() {
  const [searchParams] = useSearchParams();
  const identifier = searchParams.get("id") ?? searchParams.get("slug");
  return (
    <Navigate
      to={identifier ? `/product/${encodeURIComponent(identifier)}` : "/shop"}
      replace
    />
  );
}

interface SoonRoute {
  path: string;
  title: string;
  phase: string;
  description: string;
}

const SOON_ROUTES: SoonRoute[] = [
  {
    path: "cart",
    title: "Cart",
    phase: "Phase 4",
    description:
      "Your server-backed cart with quantity controls, stock checks, and authoritative totals.",
  },
  {
    path: "wishlist",
    title: "Wishlist",
    phase: "Phase 4",
    description:
      "Saved products tied to your account, with quick add-to-cart and removal.",
  },
  {
    path: "login",
    title: "Sign in",
    phase: "Phase 4",
    description:
      "Secure sign-in with verified accounts, return-to-page behaviour, and clear error states.",
  },
  {
    path: "signup",
    title: "Create account",
    phase: "Phase 4",
    description:
      "Registration with email verification, accessible validation, and no password shortcuts.",
  },
  {
    path: "verify",
    title: "Verify email",
    phase: "Phase 4",
    description:
      "The verification link flow will report success, expiry, and already-verified states honestly.",
  },
  {
    path: "forgot-password",
    title: "Forgot password",
    phase: "Phase 4",
    description:
      "Request a password reset link with a neutral response that does not reveal account existence.",
  },
  {
    path: "reset-password",
    title: "Reset password",
    phase: "Phase 4",
    description:
      "Choose a new password with strength guidance and server-enforced token validation.",
  },
  {
    path: "account",
    title: "Your account",
    phase: "Phase 4",
    description:
      "Profile details, session state, and links to addresses and order history.",
  },
  {
    path: "account/addresses",
    title: "Addresses",
    phase: "Phase 4",
    description:
      "Create, edit, delete, and choose a default delivery address for checkout.",
  },
  {
    path: "checkout",
    title: "Checkout",
    phase: "Phase 4",
    description:
      "Cash-on-delivery checkout with validated address selection and idempotent order placement.",
  },
  {
    path: "orders",
    title: "Order history",
    phase: "Phase 4",
    description:
      "Every order with totals, item lines, and an accessible status timeline.",
  },
  {
    path: "orders/:id",
    title: "Order details",
    phase: "Phase 4",
    description:
      "A single order with delivery address, itemised totals, and status events.",
  },
];

export const router = createBrowserRouter([
  // Legacy entry points keep working during and after the cutover.
  { path: "/index.html", element: <Navigate to="/" replace /> },
  { path: "/products.html", element: <LegacyRedirect to="/shop" keepSearch /> },
  { path: "/categories.html", element: <LegacyRedirect to="/categories" keepSearch /> },
  { path: "/cart.html", element: <Navigate to="/cart" replace /> },
  { path: "/wishlist.html", element: <Navigate to="/wishlist" replace /> },
  { path: "/checkout.html", element: <Navigate to="/checkout" replace /> },
  { path: "/profile.html", element: <Navigate to="/account" replace /> },
  { path: "/thankyou.html", element: <Navigate to="/orders" replace /> },
  { path: "/about.html", element: <Navigate to="/about" replace /> },
  { path: "/contact.html", element: <Navigate to="/contact" replace /> },
  { path: "/services.html", element: <Navigate to="/services" replace /> },
  { path: "/signup.html", element: <Navigate to="/signup" replace /> },
  { path: "/forgot-password.html", element: <Navigate to="/forgot-password" replace /> },
  {
    path: "/login.html",
    element: <LegacyRedirect to="/login" keepSearch />,
  },
  {
    path: "/verify.html",
    element: <LegacyRedirect to="/verify" keepSearch />,
  },
  {
    path: "/reset-password.html",
    element: <LegacyRedirect to="/reset-password" keepSearch />,
  },
  {
    path: "/product-details.html",
    element: <LegacyProductRedirect />,
  },
  { path: "/404.html", element: <NotFoundPage /> },

  // Legacy admin entry points redirect into the React admin (Phase 5).
  { path: "/admin/dashboard.html", element: <Navigate to="/admin" replace /> },
  { path: "/admin/products.html", element: <Navigate to="/admin/products" replace /> },
  { path: "/admin/categories.html", element: <Navigate to="/admin/categories" replace /> },
  { path: "/admin/orders.html", element: <Navigate to="/admin/orders" replace /> },
  { path: "/admin/order-detail.html", element: <Navigate to="/admin/orders" replace /> },
  { path: "/admin/product-form.html", element: <Navigate to="/admin/products" replace /> },
  { path: "/admin/add-product.html", element: <Navigate to="/admin/products/new" replace /> },

  {
    path: "/",
    element: <StorefrontLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: withSuspense(<HomePage />) },
      { path: "shop", element: withSuspense(<ShopPage />) },
      { path: "search", element: withSuspense(<SearchPage />) },
      { path: "product/:slug", element: withSuspense(<ProductPage />) },
      { path: "categories", element: withSuspense(<CategoriesPage />) },
      { path: "categories/:slug", element: <LegacyCategoryRedirect /> },
      { path: "about", element: withSuspense(<AboutPage />) },
      { path: "contact", element: withSuspense(<ContactPage />) },
      { path: "services", element: withSuspense(<ServicesPage />) },
      { path: "help", element: withSuspense(<HelpPage />) },
      { path: "shipping", element: withSuspense(<ShippingPage />) },
      { path: "returns", element: withSuspense(<ReturnsPage />) },
      { path: "privacy", element: withSuspense(<PrivacyPage />) },
      { path: "terms", element: withSuspense(<TermsPage />) },
      ...SOON_ROUTES.map((route) => ({
        path: route.path,
        element: (
          <ComingSoonPage
            title={route.title}
            phase={route.phase}
            description={route.description}
          />
        ),
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },

  // Standalone so the storefront header is not shown on admin routes.
  { path: "/admin/*", element: <AdminPlaceholderPage /> },
]);
