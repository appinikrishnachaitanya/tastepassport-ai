import Link from "next/link";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "About us · TastePassport",
  description:
    "Your interests are the starting point for feeling at home in a new city.",
};
export default function About() {
  return (
    <main className="about-page">
      <nav aria-label="About navigation">
        <Link className="about-brand" href="/">
          TastePassport <small>AI</small>
        </Link>
        <Link href="/">Start exploring →</Link>
      </nav>
      <header className="about-hero">
        <span className="micro-label">YOUR TASTES TRAVEL WITH YOU</span>
        <h1>
          A new city.
          <br />A familiar feeling.
        </h1>
        <p>
          The artist you play on repeat. The film you love. The food you miss.
          TastePassport connects those interests to places and experiences worth
          discovering.
        </p>
      </header>
      <section>
        <h2>More than another list of places.</h2>
        <p>
          Finding somewhere popular is easy. Finding somewhere that feels like
          you takes a little more understanding. We built TastePassport to help
          you explore a city through your own cultural interests.
        </p>
      </section>
      <section className="about-steps" aria-label="How TastePassport works">
        <article>
          <span>01</span>
          <h2>Bring your interests</h2>
          <p>
            Choose the artists, films, books and food you already enjoy. Confirm
            the matches so your Passport starts with the right meaning.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>Find your connection</h2>
          <p>
            Discover suggestions shaped by those interests. Adjust your budget
            and preferences, or find common ground with someone else.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>Make a day of it</h2>
          <p>
            Keep your favorites, choose a date and save an outing. Take it with
            you in your calendar when you’re ready to explore.
          </p>
        </article>
      </section>
      <section>
        <h2>Useful suggestions. Honest details.</h2>
        <p>
          Qloo supplies cultural connections and recommendations; Gemini helps
          interpret your requests. We show details that are actually available
          and keep your current discoveries when an optional service is
          unavailable.
        </p>
        <p>
          A saved outing is your personal plan. Always check current prices,
          opening hours and availability. TastePassport does not place orders or
          make reservations.
        </p>
      </section>
      <section className="about-cta">
        <h2>Make the city yours.</h2>
        <p>
          Explore as a guest. Create an account when you want to keep your
          Passports and plans.
        </p>
        <Link className="primary-button" href="/">
          Build your Passport →
        </Link>
      </section>
      <footer className="workspace-footer">
        <Link href="/">TastePassport</Link>
        <Link href="/privacy">Privacy &amp; your data</Link>
      </footer>
    </main>
  );
}
