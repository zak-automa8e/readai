import { Button } from "./ui/button";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const BackToLibrary = () => {
  const navigate = useNavigate();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="absolute top-4 left-4 z-10"
      onClick={() => navigate('/library')}
    >
      <ChevronLeft className="h-4 w-4 mr-2" />
      Back to Library
    </Button>
  );
};
