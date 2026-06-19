import Link from "next/link";

const STYLES = [
  { label: "Disney Style", desc: "Bright, Pixar-like character art" },
  { label: "Oil Painting", desc: "Rich classical portrait" },
  { label: "Watercolor", desc: "Soft, dreamy illustration" },
];

const STEPS = [
  { num: "01", title: "Upload a Photo", desc: "One clear photo of your pet — JPEG, PNG, or WebP." },
  { num: "02", title: "AI Creates 3 Styles", desc: "Disney, Oil Painting, and Watercolor — generated simultaneously." },
  { num: "03", title: "Pick Your Favorite", desc: "Select the artwork you love and download it." },
];

export default function Home() {
  return (
    <main className="min-h-screen">

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <span
            className="text-3xl text-[var(--color-foreground)]"
            style={{ fontFamily: "var(--font-script)" }}
          >
            petpho.
          </span>
          <Link
            href="/create"
            className="rounded-full bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
          >
            Create Now
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl space-y-4 px-6 pt-20 pb-16 text-center sm:pt-32 sm:pb-24">
        <p
          className="text-2xl text-[var(--color-accent)]"
          style={{ fontFamily: "var(--font-script)", color: "oklch(0.6 0.12 20)" }}
        >
          let&apos;s create
        </p>
        <h1
          className="text-4xl font-medium tracking-tight sm:text-6xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Turn your pet into<br />a one-of-a-kind artwork
        </h1>
        <p className="mx-auto max-w-md text-sm text-[var(--color-muted-foreground)] sm:text-base leading-relaxed">
          Upload one photo — AI generates 3 styles simultaneously.<br className="hidden sm:inline" />
          Pick your favorite and download.
        </p>
        <div className="pt-4">
          <Link
            href="/create"
            className="inline-block rounded-full bg-orange-500 px-8 py-3.5 text-sm font-medium text-white shadow-sm hover:bg-orange-600 transition-colors"
          >
            Start creating — it&apos;s free
          </Link>
        </div>
      </section>

      {/* Three Styles */}
      <section className="mx-auto max-w-3xl px-6 pb-24 space-y-8">
        <div className="rounded-3xl border border-[rgba(28,25,23,0.05)] bg-[var(--color-card)] p-6 shadow-sm sm:p-10">
          <div className="mb-6 space-y-1">
            <p
              className="text-xl"
              style={{ fontFamily: "var(--font-script)", color: "oklch(0.6 0.12 20)" }}
            >
              styles
            </p>
            <h2
              className="text-xl font-medium sm:text-2xl"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Three styles, one photo
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {STYLES.map((s, i) => (
              <div
                key={s.label}
                className="rounded-2xl border border-[rgba(28,25,23,0.06)] bg-[var(--color-background)] p-5"
              >
                <div
                  className="mb-1 text-xs font-medium text-orange-500"
                  style={{ fontFamily: "var(--font-script)", fontSize: "1rem" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <p className="font-medium text-sm" style={{ fontFamily: "var(--font-serif)" }}>
                  {s.label}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="rounded-3xl border border-[rgba(28,25,23,0.05)] bg-[var(--color-card)] p-6 shadow-sm sm:p-10">
          <div className="mb-6 space-y-1">
            <p
              className="text-xl"
              style={{ fontFamily: "var(--font-script)", color: "oklch(0.6 0.12 20)" }}
            >
              how it works
            </p>
            <h2
              className="text-xl font-medium sm:text-2xl"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Three steps, minutes not hours
            </h2>
          </div>
          <ol className="space-y-6">
            {STEPS.map((step) => (
              <li key={step.num} className="flex items-start gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-600">
                  {step.num}
                </span>
                <div>
                  <p className="font-medium text-sm" style={{ fontFamily: "var(--font-serif)" }}>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <Link
              href="/create"
              className="inline-block rounded-full bg-orange-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Try it now →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] py-10 text-center text-xs text-[var(--color-muted-foreground)]">
        <p
          className="text-2xl text-[var(--color-foreground)]"
          style={{ fontFamily: "var(--font-script)" }}
        >
          petpho.
        </p>
        <p className="mt-2">© 2026 PETPHO. All rights reserved.</p>
      </footer>
    </main>
  );
}
