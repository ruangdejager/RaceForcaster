import { useState } from 'react';
import type { CheckpointKind } from '@raceforecaster/core';

interface Props {
  totalDistanceM: number;
  onAdd: (distanceKm: number, name: string, kind: Extract<CheckpointKind, 'checkpoint' | 'water'>) => void;
}

/**
 * Lets anyone viewing a plan mark their own stop along the route — a family
 * meeting point, a water tap the official list missed — without needing the
 * upload/route-management privilege that changing the actual course does.
 * It only ever edits the local settings snapshot, same as a stop-minute tweak.
 */
export function AddCheckpointForm({ totalDistanceM, onAdd }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [kind, setKind] = useState<Extract<CheckpointKind, 'checkpoint' | 'water'>>('checkpoint');

  const maxKm = totalDistanceM / 1000;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km < 0 || km > maxKm) return;
    onAdd(km, name, kind);
    setName('');
    setDistanceKm('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="add-cp-toggle" onClick={() => setOpen(true)}>
        + Add checkpoint or water point
      </button>
    );
  }

  return (
    <form className="add-cp-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        required
        autoFocus
      />
      <input
        type="number"
        placeholder="km"
        value={distanceKm}
        onChange={(e) => setDistanceKm(e.target.value)}
        min={0}
        max={maxKm}
        step={0.1}
        required
      />
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="checkpoint">Checkpoint</option>
        <option value="water">Water point</option>
      </select>
      <button type="submit" className="add-cp-submit">
        Add
      </button>
      <button type="button" className="add-cp-cancel" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
