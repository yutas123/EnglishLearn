type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  explanation: string | null;
};

export default function LyricsList({ lines }: { lines: Line[] }) {
  return (
    <div className="flex flex-col divide-y divide-zinc-100">
      {lines.map((line) => (
        <div key={line.id} className="flex flex-col gap-1 py-3">
          <p className="break-words font-medium leading-relaxed">
            {line.original}
          </p>
          {line.translation && (
            <p className="break-words text-sm text-zinc-500">
              {line.translation}
            </p>
          )}
          {line.explanation && (
            <details className="text-sm text-zinc-400">
              <summary className="cursor-pointer select-none italic">
                💡 解説
              </summary>
              <p className="mt-1 break-words">{line.explanation}</p>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
