import { InputHTMLAttributes, useState, FormEvent } from "react";
import { Input } from "./input";
import { Button } from "./button";
import { Send } from "lucide-react";

interface TextInputProps {
  className?: string;
  onMessageSubmit?: (value: string) => void;
  placeholder?: string;
}

export const TextInput = ({ className, onMessageSubmit, placeholder }: TextInputProps) => {
  const [value, setValue] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && onMessageSubmit) {
      onMessageSubmit(value.trim());
      setValue("");
    }
  };
  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t w-full">
      <Input 
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`bg-secondary/50 ${className || ''}`}
        placeholder={placeholder}
      />
      <Button type="submit" size="icon" className="shrink-0" disabled={!value.trim()}>
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
};
