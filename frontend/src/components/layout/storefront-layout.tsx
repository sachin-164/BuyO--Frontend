import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

/** Move focus to the main landmark on client-side navigation. */
function RouteFocus() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const main = document.getElementById("main");
    main?.focus({ preventScroll: true });
  }, [location.pathname]);

  return null;
}

export function StorefrontLayout() {
  const location = useLocation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {/*
          Opacity-only route fade: 160 ms keeps navigation feeling immediate and
          avoids moving the page under the reader. Search-param changes on the
          same pathname do not remount the page, so filtering stays instant.
        */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <Outlet />
        </motion.div>
      </main>
      <SiteFooter />
      <ScrollRestoration />
      <RouteFocus />
    </div>
  );
}
