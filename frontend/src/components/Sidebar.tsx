import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { 
  Home, 
  BarChart3, 
  BookOpen, 
  Search, 
  Mic2, 
  Settings, 
  PieChart,
  ChevronLeft,
  ChevronRight,
  User,
  LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navigationItems = [
  { 
    icon: Home, 
    label: "Home", 
    path: "/"
  },
  { 
    icon: BarChart3, 
    label: "Dashboard", 
    path: "/dashboard"
  },
  { 
    icon: BookOpen, 
    label: "Library", 
    path: "/library"
  },
  { 
    icon: Search, 
    label: "Discover", 
    path: "/discover"
  },
  { 
    icon: Mic2, 
    label: "Voice Studio", 
    path: "/voices"
  },
  { 
    icon: PieChart, 
    label: "Analytics", 
    path: "/analytics"
  },
  { 
    icon: Settings, 
    label: "Settings", 
    path: "/settings"
  },
];

export const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <aside className={cn(
      "h-full flex flex-col bg-background border-e border-border transition-[width] duration-200",
      isCollapsed ? "w-14" : "w-64"
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center border-b border-border h-14",
        isCollapsed ? "justify-center px-2" : "justify-between px-4"
      )}>
        {!isCollapsed && (
          <div className="flex items-center">
            <BrandLogo className="h-7" />
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          ) : (
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navigationItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          
          return (
            <Button
              key={item.path}
              variant="ghost"
              className={cn(
                "w-full justify-start text-start transition-colors",
                isActive
                  ? "bg-muted text-primary hover:bg-muted hover:text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                isCollapsed ? "px-2 justify-center" : "px-3"
              )}
              onClick={() => navigate(item.path)}
            >
              <Icon className={cn(
                "h-4 w-4",
                isCollapsed ? "" : "me-2"
              )} />
              {!isCollapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </Button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border">
        {!isCollapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start p-2 h-auto">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <div className="flex flex-col text-start">
                    <span className="text-sm font-medium text-foreground">
                      {user?.display_name || user?.email || 'User'}
                    </span>
                    <span className="text-xs text-muted-foreground">Free Plan</span>
                  </div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="me-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="me-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                {user?.display_name || user?.email || 'User'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="me-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="me-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </aside>
  );
};
