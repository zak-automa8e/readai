import { ContentLayout } from "@/components/layouts/ContentLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  BookOpen, 
  Bot, 
  Mic, 
  BarChart3, 
  Upload,
  ArrowRight,
  Sparkles
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBooks } from "@/contexts/BooksContext";

const Home = () => {
  const navigate = useNavigate();
  const { books } = useBooks();

  const features = [
    {
      icon: Bot,
      title: "AI-Powered Reading",
      description: "Chat with your documents using advanced AI assistance"
    },
    {
      icon: Mic,
      title: "Text-to-Speech",
      description: "Listen to your books with high-quality voice synthesis"
    },
    {
      icon: BarChart3,
      title: "Reading Analytics",
      description: "Track your progress and reading habits over time"
    },
    {
      icon: Sparkles,
      title: "Smart Annotations",
      description: "Intelligent note-taking and highlighting features"
    }
  ];

  return (
    <ContentLayout>
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Hero Section */}
        <section className="text-center space-y-6">
          <div className="space-y-3">
            <h1 className="text-4xl lg:text-6xl font-light text-foreground">
              Welcome to{" "}
              <span className="text-primary font-semibold">
                Narwi
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Transform your reading experience with AI-powered assistance, 
              immersive audio, and intelligent insights.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              size="lg"
              onClick={() => navigate('/library')}
              className="gap-2"
            >
              <BookOpen className="h-5 w-5" />
              {books.length > 0 ? 'Go to Library' : 'Upload Your First Book'}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/dashboard')}
              className="gap-2"
            >
              <BarChart3 className="h-5 w-5" />
              View Dashboard
            </Button>
          </div>
        </section>

        {/* Features Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={index}
                className="shadow-none p-6 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </section>

        {/* Quick Actions */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-center">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card 
              className="shadow-none p-4 cursor-pointer transition-colors hover:border-primary/40"
              onClick={() => navigate('/library')}
            >
              <div className="text-center space-y-3">
                <BookOpen className="h-6 w-6 text-muted-foreground mx-auto" />
                <div>
                  <h3 className="font-medium">Library</h3>
                  <p className="text-sm text-muted-foreground">
                    {books.length} book{books.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </Card>

            <Card 
              className="shadow-none p-4 cursor-pointer transition-colors hover:border-primary/40"
              onClick={() => navigate('/library')}
            >
              <div className="text-center space-y-3">
                <Upload className="h-6 w-6 text-muted-foreground mx-auto" />
                <div>
                  <h3 className="font-medium">Upload</h3>
                  <p className="text-sm text-muted-foreground">Add new book</p>
                </div>
              </div>
            </Card>

            <Card 
              className="shadow-none p-4 cursor-pointer transition-colors hover:border-primary/40"
              onClick={() => navigate('/settings')}
            >
              <div className="text-center space-y-3">
                <Mic className="h-6 w-6 text-muted-foreground mx-auto" />
                <div>
                  <h3 className="font-medium">Voice Settings</h3>
                  <p className="text-sm text-muted-foreground">Configure TTS</p>
                </div>
              </div>
            </Card>

            <Card 
              className="shadow-none p-4 cursor-pointer transition-colors hover:border-primary/40"
              onClick={() => navigate('/analytics')}
            >
              <div className="text-center space-y-3">
                <BarChart3 className="h-6 w-6 text-muted-foreground mx-auto" />
                <div>
                  <h3 className="font-medium">Analytics</h3>
                  <p className="text-sm text-muted-foreground">View insights</p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* Recent Activity */}
        {books.length > 0 && (
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold text-center">Recent Books</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {books.slice(0, 3).map((book) => (
                <Card 
                  key={book.id}
                  className="shadow-none p-4 cursor-pointer transition-colors hover:border-primary/40"
                  onClick={() => {
                    // Note: We'll need to ensure the book selection still works
                    navigate('/library');
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-16 bg-muted rounded-sm flex items-center justify-center">
                      {book.defaultCover ? (
                        <img 
                          src={book.defaultCover}
                          alt={book.title}
                          className="w-full h-full object-cover rounded-sm"
                        />
                      ) : (
                        <BookOpen className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-serif font-medium truncate">{book.title}</h3>
                      {book.author && (
                        <p className="text-sm text-muted-foreground truncate">
                          {book.author}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Added {book.uploadDate.toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </ContentLayout>
  );
};

export default Home;
