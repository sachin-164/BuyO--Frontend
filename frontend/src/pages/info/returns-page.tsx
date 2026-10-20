import { InfoPage } from "@/pages/info/info-page";

export default function ReturnsPage() {
  return (
    <InfoPage
      title="Returns"
      intro="No returns, exchange, or refund policy has been published yet. Do not assume a return window or process. This page marks the decisions the owner still needs to make."
      draft
      sections={[
        {
          heading: "Before you order",
          body: (
            <p>
              If the ability to return an item is essential to your purchase, wait until this
              policy is published. Nothing on the product pages or checkout currently promises
              a return, exchange, or refund.
            </p>
          ),
        },
        {
          heading: "If something arrives damaged or incorrect",
          body: (
            <p>
              A public support channel and a documented resolution process are not available
              yet. The order record in your account shows what was ordered and the delivery
              address used, which will be the starting point once a process exists.
            </p>
          ),
        },
        {
          heading: "Policy decisions still required",
          body: (
            <p>
              The return window, eligible and excluded items, condition requirements, refund
              method and timing, exchange rules, and who pays return shipping have not been
              decided. They will appear here only when the owner confirms them.
            </p>
          ),
        },
      ]}
      ownerInput={[
        "Return window and the date it starts from",
        "Items that cannot be returned for hygiene, safety, or other reasons",
        "Condition and packaging requirements",
        "Refund method and expected processing time",
        "Exchange rules and who pays return shipping",
        "The support route customers should use to start a return",
      ]}
    />
  );
}
