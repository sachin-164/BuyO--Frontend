import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { OwnerInputNotice } from "@/components/info/owner-input-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

export interface InfoSection {
  heading: string;
  body: ReactNode;
}

interface InfoPageProps {
  title: string;
  intro: string;
  sections: InfoSection[];
  ownerInput?: string[];
  draft?: boolean;
}

function sectionId(index: number) {
  return `info-section-${index + 1}`;
}

export function InfoPage({ title, intro, sections, ownerInput = [], draft = false }: InfoPageProps) {
  usePageTitle(title);

  return (
    <div className="container-page py-8 sm:py-10">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: title }]} />

      <header className="mt-6 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {draft ? <Badge variant="secondary">Draft — owner review required</Badge> : null}
        </div>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{intro}</p>
      </header>

      {ownerInput.length > 0 ? (
        <div className="mt-8 max-w-3xl">
          <OwnerInputNotice items={ownerInput} />
        </div>
      ) : null}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-start">
        <article className="max-w-3xl space-y-10">
          {sections.map((section, index) => (
            <section
              key={section.heading}
              id={sectionId(index)}
              aria-labelledby={`${sectionId(index)}-heading`}
              className="scroll-mt-24"
            >
              <h2
                id={`${sectionId(index)}-heading`}
                className="text-xl font-semibold tracking-tight sm:text-2xl"
              >
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {section.body}
              </div>
            </section>
          ))}

          <section aria-labelledby="still-help-heading" className="rounded-lg border border-border bg-card p-6">
            <h2 id="still-help-heading" className="text-lg font-semibold">
              Still need help?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Account and order questions are easiest to answer from your signed-in
              account, where the relevant details are already available.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/account">Go to account</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/orders">View orders</Link>
              </Button>
            </div>
          </section>
        </article>

        {sections.length > 2 ? (
          <nav aria-label="On this page" className="hidden lg:block lg:sticky lg:top-24">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              On this page
            </p>
            <ul className="mt-3 space-y-2 border-l border-border pl-4">
              {sections.map((section, index) => (
                <li key={section.heading}>
                  <a
                    href={`#${sectionId(index)}`}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {section.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
