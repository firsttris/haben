/** Knöpfe nebeneinander, von denen einer gedrückt ist, etwa Größe und Stelle des Logos */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  disabledValues,
  describedBy,
}: {
  label: string;
  options: { value: T; label: string; name: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
  /** Einzelne Werte aus, etwa „Mitte“, wenn kein Layout das Logo mittig setzt; ein gespeicherter Wert bleibt gedrückt */
  disabledValues?: readonly T[] | undefined;
  describedBy?: string | undefined;
}) {
  return (
    <div className="segmented" role="group" aria-label={label} aria-describedby={describedBy}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="btn btn-sm"
          title={option.name}
          aria-pressed={value === option.value}
          disabled={disabled || disabledValues?.includes(option.value)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
