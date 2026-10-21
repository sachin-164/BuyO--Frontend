import { Suspense, lazy, type ReactNode } from "react";
import {
  Navigate,
  createBrowserRouter,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { StorefrontLayout } from "@/components/layout/storefront-layout";
import { AdminLayout } from "@/components/admin/admin-layout";
import {
  LegacyAdminOrderRedirect,
  LegacyAdminProductRedirect,
} from "@/components/admin/legacy-admin-redirect";
import { Spinner } from "@/components/ui/spinner";
import NotFoundPage from "@/pages/not-found-page";
import RouteErrorPage from "@/pages/route-error-page";
import { RequireAdmin, RequireAuth } from "@/features/auth/guards";

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
const CartPage = lazy(() => import("@/pages/cart-page"));
const WishlistPage = lazy(() => import("@/pages/wishlist-page"));
const LoginPage = lazy(() => import("@/pages/auth/login-page"));
const SignupPage = lazy(() => import("@/pages/auth/signup-page"));
const VerifyPage = lazy(() => import("@/pages/auth/verify-page"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password-page"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/reset-password-page"));
const AccountPage = lazy(() => import("@/pages/account-page"));
const AddressesPage = lazy(() => import("@/pages/addresses-page"));
const CheckoutPage = lazy(() => import("@/pages/checkout-page"));
const OrderConfirmationPage = lazy(() => import("@/pages/order-confirmation-page"));
const OrdersPage = lazy(() => import("@/pages/orders-page"));
const OrderDetailPage = lazy(() => import("@/pages/order-detail-page"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/dashboard-page"));
const AdminProductsPage = lazy(() => import("@/pages/admin/products-page"));
const AdminProductFormPage = lazy(() => import("@/pages/admin/product-form-page"));
const AdminCategoriesPage = lazy(() => import("@/pages/admin/categories-page"));
const AdminOrdersPage = lazy(() => import("@/pages/admin/orders-page"));
const AdminOrderDetailPage = lazy(() => import("@/pages/admin/order-detail-page"));
const AdminCustomersPage = lazy(() => import("@/pages/admin/customers-page"));
const AdminCustomerDetailPage = lazy(() => import("@/pages/admin/customer-detail-page"));

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
  { path: "/admin/order-detail.html", element: <LegacyAdminOrderRedirect /> },
  { path: "/admin/product-form.html", element: <LegacyAdminProductRedirect /> },
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

      // Auth flows are public; verification status is reported honestly.
      { path: "login", element: withSuspense(<LoginPage />) },
      { path: "signup", element: withSuspense(<SignupPage />) },
      { path: "verify", element: withSuspense(<VerifyPage />) },
      { path: "forgot-password", element: withSuspense(<ForgotPasswordPage />) },
      { path: "reset-password", element: withSuspense(<ResetPasswordPage />) },

      // Shopping and account sections are server-authorized at all times.
      { path: "cart", element: withSuspense(<RequireAuth><CartPage /></RequireAuth>) },
      { path: "wishlist", element: withSuspense(<RequireAuth><WishlistPage /></RequireAuth>) },
      { path: "account", element: withSuspense(<RequireAuth><AccountPage /></RequireAuth>) },
      {
        path: "account/addresses",
        element: withSuspense(
          <RequireAuth>
            <AddressesPage />
          </RequireAuth>,
        ),
      },
      { path: "checkout", element: withSuspense(<RequireAuth><CheckoutPage /></RequireAuth>) },
      {
        path: "checkout/confirmation/:id",
        element: withSuspense(
          <RequireAuth>
            <OrderConfirmationPage />
          </RequireAuth>,
        ),
      },
      { path: "orders", element: withSuspense(<RequireAuth><OrdersPage /></RequireAuth>) },
      {
        path: "orders/:id",
        element: withSuspense(
          <RequireAuth>
            <OrderDetailPage />
          </RequireAuth>,
        ),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },

  // Standalone so the storefront header is not shown on admin routes.
  {
    path: "/admin",
    element: (
      <RequireAdmin>
        <AdminLayout />
      </RequireAdmin>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: withSuspense(<AdminDashboardPage />) },
      { path: "products", element: withSuspense(<AdminProductsPage />) },
      { path: "products/new", element: withSuspense(<AdminProductFormPage />) },
      { path: "products/:id/edit", element: withSuspense(<AdminProductFormPage />) },
      { path: "categories", element: withSuspense(<AdminCategoriesPage />) },
      { path: "orders", element: withSuspense(<AdminOrdersPage />) },
      { path: "orders/:id", element: withSuspense(<AdminOrderDetailPage />) },
      { path: "customers", element: withSuspense(<AdminCustomersPage />) },
      { path: "customers/:id", element: withSuspense(<AdminCustomerDetailPage />) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
