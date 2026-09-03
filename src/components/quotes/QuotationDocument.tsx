export function QuotationDocument({
  quote: q,
  totals: t,
}: {
  quote: any;
  totals: any;
}) {
  const company = q.company || {};
  return (
    <article
      className="card quote-paper"
      style={{ maxWidth: 1000, margin: "0 auto", padding: 40 }}
    >
      <header
        className="flex justify-between gap-8 border-b pb-7"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          {company.logo && (
            <img
              src={company.logo}
              alt={company.companyName}
              style={{ height: 50, objectFit: "contain", marginBottom: 14 }}
            />
          )}
          <h2 className="text-xl font-bold">
            {company.companyName || "E-SOLUTIONS"}
          </h2>
          <p className="muted text-xs mt-2 whitespace-pre-line">
            {company.address}
            <br />
            {[company.email, company.phone, company.website]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {company.taxNumber && (
            <p className="muted text-xs">
              Tax registration: {company.taxNumber}
            </p>
          )}
          {company.commercialRegistration && (
            <p className="muted text-xs">
              Commercial registration: {company.commercialRegistration}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="eyebrow">COMMERCIAL QUOTATION</p>
          <h2 className="text-xl font-semibold">{q.quoteNumber}</h2>
          <p className="muted text-sm">
            Revision {q.revision} · {new Date(q.createdAt).toLocaleDateString()}
          </p>
          <p className="badge mt-3">{q.status}</p>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-8 py-7">
        <div>
          <p className="eyebrow">PREPARED FOR</p>
          <h3 className="font-semibold">
            {typeof q.project?.client === "string"
              ? q.project.client
              : q.project?.client?.companyName}
          </h3>
          <p className="muted text-sm mt-2">{q.project?.name}</p>
          {q.project?.consultant && (
            <p className="muted text-sm">
              Consultant:{" "}
              {typeof q.project.consultant === "string"
                ? q.project.consultant
                : q.project.consultant.companyName}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
          <p>
            Currency: <strong>{q.currency}</strong>
          </p>
          <p className="mt-2">
            Valid until:{" "}
            <strong>
              {q.validUntil
                ? new Date(q.validUntil).toLocaleDateString()
                : "Not specified"}
            </strong>
          </p>
        </div>
      </section>
      <table className="data-table">
        <thead>
          <tr>
            <th>Item / description</th>
            <th>Manufacturer / part</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Unit price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {q.items.map((i: any, n: number) => (
            <tr key={n}>
              <td>{i.description}</td>
              <td>
                {i.manufacturer}
                <div className="muted text-xs">{i.partNumber}</div>
              </td>
              <td>{Number(i.quantity)}</td>
              <td>{i.unit}</td>
              <td>
                {Number(i.unitSell).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </td>
              <td>
                {Number(i.lineTotal).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="ml-auto max-w-sm my-7 space-y-2 text-sm">
        {[
          ["Subtotal", t.subtotal],
          ["Commercial discount", t.discount],
          ["VAT (" + q.vatPct + "%)", t.vat],
          ["Grand total", t.grandTotal],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="flex justify-between py-2 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <span>{label}</span>
            <strong>
              {Number(value).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {q.currency}
            </strong>
          </div>
        ))}
      </section>
      <section className="grid grid-cols-2 gap-x-8 gap-y-5">
        {Object.entries(q.terms || {})
          .filter(([, value]) => value)
          .map(([key, value]) => (
            <div key={key}>
              <h3 className="font-semibold capitalize text-xs mb-1">{key}</h3>
              <p className="muted text-xs whitespace-pre-line">
                {String(value)}
              </p>
            </div>
          ))}
      </section>
    </article>
  );
}
