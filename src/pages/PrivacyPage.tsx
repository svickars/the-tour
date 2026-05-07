import { useNav } from '../NavContext'
import '../App.css'
import './PrivacyPage.css'

export function PrivacyPage() {
  const { go } = useNav()

  return (
    <div className="passerby-page privacy-page">
      <a href="#privacy-main" className="privacy-skip-link">
        Skip to content
      </a>
      <header className="passerby-header privacy-page-top">
        <button type="button" className="wordmark wordmark--privacy" onClick={() => go('/')} aria-label="Elsewhere home">
          elsewhere
        </button>
      </header>

      <main id="privacy-main" className="privacy-main">
        <h1 className="privacy-title">Privacy</h1>
        <p className="privacy-lead">
          Elsewhere is built to keep everyday use local-first. This page describes what stays on your device, what
          travels over the network, and what we do not do.
        </p>

        <section className="privacy-section" aria-labelledby="privacy-local-heading">
          <h2 id="privacy-local-heading">What stays on your device</h2>
          <ul>
            <li>
              <strong>Saved tours, favourites, and custom names</strong> are stored in your browser using{' '}
              <strong>IndexedDB</strong>. We do not sync this library to an Elsewhere account—there are no sign-ups, and
              that data is not sent to us as a structured &quot;user profile.&quot;
            </li>
            <li>
              Elsewhere does <strong>not</strong> use cookies for app features or analytics. Normal browser storage APIs
              (IndexedDB) are used for your saved tours.
            </li>
          </ul>
        </section>

        <section className="privacy-section" aria-labelledby="privacy-network-heading">
          <h2 id="privacy-network-heading">What leaves your device</h2>
          <p>
            When you search for a place, request a tour, or use map features, your browser talks to{' '}
            <strong>our serverless APIs</strong> (hosted on Vercel) and to <strong>third-party services</strong> we rely
            on to make the product work—for example map providers, language models for scripts, and text-to-speech for
            audio. Those requests may include place names, coordinates, and generated text needed to fulfil your
            action. Those providers process data under their own terms and privacy policies.
          </p>
          <p>
            Like most hosted services, infrastructure may keep <strong>short-lived technical logs</strong> (for example
            for reliability and abuse prevention). We do not use that data to sell personal information or to run
            behavioural advertising inside Elsewhere.
          </p>
        </section>

        <section className="privacy-section" aria-labelledby="privacy-sensitive-heading">
          <h2 id="privacy-sensitive-heading">Sensitive browser features</h2>
          <ul>
            <li>
              <strong>Location:</strong> if you choose &quot;Use my location,&quot; the browser shares coordinates with
              the app (and any map or place APIs involved) only when you trigger that action, subject to your browser’s
              permission prompts.
            </li>
            <li>
              <strong>Share / copy link:</strong> uses the clipboard API when supported, only when you ask to copy a
              link.
            </li>
          </ul>
        </section>

        <section className="privacy-section" aria-labelledby="privacy-contact-heading">
          <h2 id="privacy-contact-heading">Contact</h2>
          <p>
            This experiment is from{' '}
            <a href="https://thedataface.com" target="_blank" rel="noopener noreferrer">
              DF Labs
            </a>
            . For privacy questions about Elsewhere, reach out through that site.
          </p>
        </section>

        <p className="privacy-foot">Last updated: May 2026.</p>

        <p className="privacy-home-row">
          <button type="button" className="privacy-home-btn" onClick={() => go('/')}>
            Back to Elsewhere
          </button>
        </p>
      </main>

      <footer className="passerby-footer privacy-footer">
        <p className="passerby-footer-text">
          <button type="button" className="passerby-footer-link privacy-footer-link-btn" onClick={() => go('/')}>
            Home
          </button>
          {' · '}
          <span>Privacy</span>
        </p>
      </footer>
    </div>
  )
}
