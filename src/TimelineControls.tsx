import { useEffect, useState } from "react";
import {
  timelineDefinition,
  timelineTime,
  timelineDuration,
  type TimelineSelection,
} from "../shared/timelines";
import { sgTime } from "../shared/catalog";

export function TimelineControls({
  selection,
  busy,
  onChange,
}: {
  selection: TimelineSelection;
  busy: boolean;
  onChange: (value: TimelineSelection) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const definition = timelineDefinition(selection.id);
  useEffect(() => {
    if (!playing || busy || selection.minute >= timelineDuration) return;
    const timer = window.setTimeout(
      () => onChange({ ...selection, minute: selection.minute + 1 }),
      60000 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [playing, busy, selection, speed, onChange]);
  const jump = (minute: number) => {
    setPlaying(false);
    onChange({ ...selection, minute });
  };
  return (
    <div className="timeline-controls">
      <strong>
        SIMULATED · <time>{sgTime(timelineTime(selection))}</time> SGT
      </strong>
      <p>
        {
          definition.events
            .filter((event) => event.minute <= selection.minute)
            .at(-1)!.label
        }
      </p>
      <div className="timeline-actions">
        <button
          type="button"
          disabled={selection.minute >= timelineDuration}
          onClick={() => setPlaying(!playing)}
        >
          {playing && selection.minute < timelineDuration
            ? "Pause timeline"
            : "Play timeline"}
        </button>
        <button type="button" onClick={() => jump(0)}>
          Restart timeline
        </button>
        <label>
          Speed
          <select
            aria-label="Timeline speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value={1}>1×</option>
            <option value={10}>10×</option>
            <option value={60}>60×</option>
          </select>
        </label>
      </div>
      <label>
        Simulation minute: {selection.minute} / {timelineDuration}
        <input
          aria-label="Timeline minute"
          type="range"
          min={0}
          max={timelineDuration}
          value={selection.minute}
          onChange={(event) => jump(Number(event.target.value))}
        />
      </label>
      <label>
        Jump to event
        <select
          aria-label="Jump to timeline event"
          value=""
          onChange={(event) => jump(Number(event.target.value))}
        >
          <option value="" disabled>
            Choose event
          </option>
          {definition.events.map((event) => (
            <option key={event.minute} value={event.minute}>
              +{event.minute} min · {event.label}
            </option>
          ))}
          <option value={60}>+60 min · End</option>
        </select>
      </label>
      <small>
        {busy
          ? "Updating routes…"
          : selection.minute === timelineDuration
            ? "Timeline complete."
            : "Replans at each simulated minute. Journey progress stays manual."}
      </small>
    </div>
  );
}
