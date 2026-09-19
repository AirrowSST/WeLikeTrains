import { useState } from "react";
import {
  Bike,
  Coffee,
  CupSoda,
  Footprints,
  Gift,
  Leaf,
  UsersRound,
} from "lucide-react";
import {
  demoRewards,
  pointsBalance,
  type PointsWallet,
} from "../shared/rewards";

export default function Rewards({
  wallet,
  demo,
  onRedeem,
}: {
  wallet: PointsWallet;
  demo: boolean;
  onRedeem: (id: string) => void;
}) {
  const balance = pointsBalance(wallet);
  const [confirmReward, setConfirmReward] = useState<string | null>(null);
  return (
    <div className="rewards-page">
      <section className="rewards-balance" aria-label="Points balance">
        <span className="eyebrow">
          {demo ? "DEMO POINTS" : "YOUR WAYCE POINTS"}
        </span>
        <div>
          <Leaf size={26} aria-hidden="true" />
          <strong>{balance.toLocaleString()}</strong>
          <span>pts</span>
        </div>
        <p>A little movement. A little more reward.</p>
        <small>
          {demo
            ? "Simulated points · discarded when you leave the demo"
            : "Saved on this device · separate for each account"}
        </small>
      </section>
      <section className="rewards-section" aria-labelledby="earn-points-title">
        <h2 id="earn-points-title">Good choices add up</h2>
        <p>Complete your journey to collect points.</p>
        <div className="earn-points-row">
          <span className="reward-icon">
            <Footprints size={23} />
            <Bike size={20} />
          </span>
          <div>
            <h3>Walk or cycle a little</h3>
            <p>1 point for every 100 metres on your route.</p>
          </div>
          <strong>10 pts/km</strong>
        </div>
        <div className="earn-points-row">
          <span className="reward-icon">
            <UsersRound size={25} />
          </span>
          <div>
            <h3>Take the quieter way</h3>
            <p>
              Choose an alternative with a lower known crowd level than the
              original route.
            </p>
          </div>
          <strong>+20 pts</strong>
        </div>
        <p className="rewards-note">
          Points use planned distances and crowd levels, with completion
          confirmed by you. Unknown crowds and blocked routes do not earn a
          quieter-route bonus.
        </p>
      </section>
      <section className="rewards-section" aria-labelledby="redeem-title">
        <h2 id="redeem-title">A little something for you</h2>
        <p className="rewards-note">
          Demo rewards only. No real vouchers, partner offers or cash value.
        </p>
        <div className="rewards-catalogue">
          {demoRewards.map((reward) => {
            const Icon =
              reward.icon === "coffee"
                ? Coffee
                : reward.icon === "smoothie"
                  ? CupSoda
                  : Bike;
            return (
              <article className="reward-card" key={reward.id}>
                <div className={`reward-art ${reward.id}`}>
                  <Icon size={44} strokeWidth={1.6} />
                  <span>DEMO REWARD</span>
                </div>
                <div className="reward-card-body">
                  <h3>{reward.title}</h3>
                  <p>{reward.description}</p>
                  <strong>{reward.cost} points</strong>
                  {confirmReward === reward.id ? (
                    <div className="reward-confirm">
                      <p>Spend {reward.cost} points on this demo reward?</p>
                      <button
                        className="primary-button full"
                        onClick={() => {
                          onRedeem(reward.id);
                          setConfirmReward(null);
                        }}
                      >
                        Confirm demo redemption
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setConfirmReward(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="secondary-button full"
                      disabled={balance < reward.cost}
                      onClick={() => setConfirmReward(reward.id)}
                    >
                      {balance < reward.cost
                        ? `${reward.cost - balance} more points to go`
                        : `Redeem ${reward.title.toLowerCase()}`}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="rewards-section" aria-labelledby="my-rewards-title">
        <h2 id="my-rewards-title">My rewards</h2>
        {!wallet.redemptions?.length ? (
          <p className="rewards-empty">
            Your redeemed demo rewards will live here.
          </p>
        ) : (
          <ul className="points-activity">
            {wallet.redemptions.slice(0, 20).map((item) => (
              <li key={item.id}>
                <Gift size={24} />
                <div>
                  <strong>{item.title}</strong>
                  <small>Demo only · cannot be used at any shop</small>
                </div>
                <b>−{item.cost}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        className="rewards-section"
        aria-labelledby="points-activity-title"
      >
        <h2 id="points-activity-title">Your points activity</h2>
        {wallet.entries.length === 0 ? (
          <p className="rewards-empty">
            Your first reward starts with a journey. Choose a route, then
            confirm each step when you arrive.
          </p>
        ) : (
          <ul className="points-activity">
            {wallet.entries.slice(0, 20).map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.title}</strong>
                  <small>
                    {new Date(entry.completedAt).toLocaleDateString("en-SG", {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {entry.activeTravel} active travel
                    {entry.quieterRoute > 0
                      ? ` + ${entry.quieterRoute} quieter route`
                      : ""}
                  </small>
                </div>
                <b>+{entry.total}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
