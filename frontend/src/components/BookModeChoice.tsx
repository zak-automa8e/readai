import { BookOpen, Headphones } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Label } from "./ui/label";
import type { BookMode } from "@/types/segments";

const OPTIONS: { value: BookMode; label: string; detail: string; Icon: typeof BookOpen }[] = [
  { value: "read", label: "Read", detail: "The PDF page, chat and notes.", Icon: BookOpen },
  {
    value: "listen",
    label: "Listen",
    detail: "Read aloud paragraph by paragraph. Preparing the text takes a few minutes.",
    Icon: Headphones,
  },
];

/** Read or Listen at upload (spec O1); either can be switched later in the reading room. */
export const BookModeChoice = ({ value, onChange }: { value: BookMode; onChange: (mode: BookMode) => void }) => (
  <div className="space-y-2">
    <Label>How will you use this book?</Label>
    <RadioGroup value={value} onValueChange={(next) => onChange(next as BookMode)} className="grid grid-cols-2 gap-2">
      {OPTIONS.map(({ value: option, label, detail, Icon }) => (
        <Label
          key={option}
          htmlFor={`book-mode-${option}`}
          className={`flex cursor-pointer flex-col gap-1.5 rounded-md border p-3 font-normal transition-colors ${
            value === option ? "border-primary bg-muted/50" : "border-border hover:bg-muted/30"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <RadioGroupItem id={`book-mode-${option}`} value={option} />
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {label}
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span>
        </Label>
      ))}
    </RadioGroup>
  </div>
);
