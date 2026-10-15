import { cn } from "@/lib/utils";

interface ContentLayoutProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
}

export const ContentLayout = ({ 
  children, 
  className, 
  title, 
  description 
}: ContentLayoutProps) => {
  return (
    <div className={cn(
      "flex flex-col h-full overflow-hidden",
      className
    )}>
      {(title || description) && (
        <div className="flex-shrink-0 p-6 border-b border-border">
          {title && (
            <h1 className="font-serif text-2xl font-semibold text-foreground mb-2">
              {title}
            </h1>
          )}
          {description && (
            <p className="text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>
  );
};
