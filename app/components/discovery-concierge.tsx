"use client";

import { Icon } from "./passport";

const requests = [
  "Find cheaper food. Keep my music and movies unchanged.",
  "Help me plan dinner and a movie.",
];

export default function DiscoveryConcierge({
  busy,
  onAsk,
  onNavigate,
}: {
  busy: boolean;
  onAsk: (request?: string) => void;
  onNavigate: (view: "preferences" | "connections" | "together") => void;
}) {
  const actions = [
    { view: "preferences", icon: "sliders", title: "Refine my discoveries", detail: "Budget, rating and the mood for one category." },
    { view: "connections", icon: "pin", title: "Find my next area", detail: "Explore taste connections and nearby food." },
    { view: "together", icon: "star", title: "Find something for us both", detail: "A shared choice shaped by two taste profiles." },
  ] as const;

  return (
    <section className="discovery-concierge" aria-labelledby="discovery-concierge-title">
      <div className="discovery-concierge-copy">
        <span className="micro-label">A LITTLE HELP FINDING YOUR NEXT FAVORITE</span>
        <h2 id="discovery-concierge-title">What would make today a good day?</h2>
        <p>Ask for a change, browse your choices, or bring someone along. You stay in control.</p>
        <button type="button" className="primary-button" onClick={() => onAsk()}>
          Ask TastePassport <Icon name="arrow" size={16} />
        </button>
        <div className="discovery-prompts" aria-label="Start a conversation">
          {requests.map(request => (
            <button key={request} type="button" disabled={busy} onClick={() => onAsk(request)}>
              {request}<Icon name="arrow" size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className="discovery-next-steps">
        <span className="micro-label">OR CHOOSE YOUR NEXT STEP</span>
        {actions.map(action => (
          <button key={action.view} type="button" onClick={() => onNavigate(action.view)}>
            <Icon name={action.icon} size={20} />
            <span><strong>{action.title}</strong><small>{action.detail}</small></span>
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
