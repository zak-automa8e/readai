import { ContentLayout } from "@/components/layouts/ContentLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  BookOpen, 
  Clock, 
  Target, 
  TrendingUp,
  Plus,
  Play,
  Calendar,
  BarChart3
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBooks, Book } from "@/contexts/BooksContext";

const Dashboard = () => {
  const navigate = useNavigate();
  const { books, setCurrentBook } = useBooks();

  // Calculate some basic stats
  const totalBooks = books.length;
  const recentBooks = books.slice(-3).reverse(); // Last 3 books, most recent first
  
  // Mock data for reading statistics (in a real app, this would come from analytics)
  const readingStats = {
    totalReadingTime: "12h 30m",
    booksThisMonth: 3,
    currentStreak: 7,
    averageSessionTime: "45m"
  };

  const handleBookClick = (book: Book) => {
    setCurrentBook(book);
    navigate('/read');
  };

  const handleUploadClick = () => {
    navigate('/library');
    // In a real implementation, you might want to trigger the upload modal directly
  };

  return (
    <ContentLayout
      title="Dashboard"
      description="Your reading overview and quick actions"
    >
      <div className="space-y-8">
        {/* Quick Actions */}
        <section className="flex flex-wrap gap-4">
          <Button 
            onClick={handleUploadClick}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add New Book
          </Button>
          <Button 
            variant="outline"
            onClick={() => navigate('/library')}
            className="gap-2"
          >
            <BookOpen className="h-4 w-4" />
            View Library
          </Button>
          <Button 
            variant="outline"
            onClick={() => navigate('/analytics')}
            className="gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            View Analytics
          </Button>
        </section>

        {/* Reading Statistics */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="shadow-none p-6 transition-colors hover:border-primary/20 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Books</p>
                <p className="font-serif text-3xl font-semibold text-foreground">{totalBooks}</p>
              </div>
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
          </Card>

          <Card className="shadow-none p-6 transition-colors hover:border-primary/20 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Reading Time</p>
                <p className="font-serif text-3xl font-semibold text-foreground">{readingStats.totalReadingTime}</p>
              </div>
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
          </Card>

          <Card className="shadow-none p-6 transition-colors hover:border-primary/20 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">This Month</p>
                <p className="font-serif text-3xl font-semibold text-foreground">{readingStats.booksThisMonth}</p>
              </div>
              <Calendar className="h-6 w-6 text-muted-foreground" />
            </div>
          </Card>

          <Card className="shadow-none p-6 transition-colors hover:border-primary/20 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current Streak</p>
                <p className="font-serif text-3xl font-semibold text-foreground">{readingStats.currentStreak} days</p>
              </div>
              <TrendingUp className="h-6 w-6 text-muted-foreground" />
            </div>
          </Card>
        </section>

        {/* Recent Activity */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Continue Reading */}
          <div className="space-y-4">
            <h2 className="font-serif text-xl font-semibold text-foreground">Continue Reading</h2>
            {recentBooks.length > 0 ? (
              <div className="space-y-3">
                {recentBooks.map((book) => (
                  <Card 
                    key={book.id}
                    className="shadow-none p-4 cursor-pointer transition-colors hover:border-primary/40"
                    onClick={() => handleBookClick(book)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-16 bg-muted rounded-sm flex items-center justify-center flex-shrink-0">
                        {book.thumbnail_url || book.coverUrl || book.defaultCover ? (
                          <img 
                            src={book.thumbnail_url || book.coverUrl || book.defaultCover}
                            alt={book.title}
                            className="w-full h-full object-cover rounded-sm"
                          />
                        ) : (
                          <BookOpen className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-serif font-medium text-foreground truncate">{book.title}</h3>
                        {book.author && (
                          <p className="text-sm text-muted-foreground truncate">{book.author}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Added {book.uploadDate.toLocaleDateString()}
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBookClick(book);
                        }}
                        className="gap-2"
                      >
                        <Play className="h-3 w-3" />
                        Read
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="shadow-none p-8 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No books yet</h3>
                <p className="text-muted-foreground mb-4">
                  Upload your first book to start reading with AI assistance
                </p>
                <Button onClick={handleUploadClick} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Your First Book
                </Button>
              </Card>
            )}
          </div>

          {/* Reading Goals */}
          <div className="space-y-4">
            <h2 className="font-serif text-xl font-semibold text-foreground">Reading Goals</h2>
            <div className="space-y-4">
              <Card className="shadow-none p-4 transition-colors hover:border-primary/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">Daily Reading</span>
                  <span className="text-sm text-muted-foreground">45/60 min</span>
                </div>
                <div className="w-full bg-muted rounded-sm h-2">
                  <div 
                    className="bg-primary h-2 rounded-sm" 
                    style={{ width: '75%' }}
                  ></div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">75% complete</p>
              </Card>

              <Card className="shadow-none p-4 transition-colors hover:border-primary/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">Monthly Books</span>
                  <span className="text-sm text-muted-foreground">3/5 books</span>
                </div>
                <div className="w-full bg-muted rounded-sm h-2">
                  <div 
                    className="bg-primary h-2 rounded-sm" 
                    style={{ width: '60%' }}
                  ></div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">60% complete</p>
              </Card>

              <Card className="shadow-none p-4 transition-colors hover:border-primary/10">
                <div className="flex items-center gap-3">
                  <Target className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <h3 className="font-medium text-foreground">Reading Streak</h3>
                    <p className="text-sm text-muted-foreground">
                      Keep it up! You're on a {readingStats.currentStreak}-day streak
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* Quick Stats */}
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground mb-4">Quick Insights</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="shadow-none p-4 text-center transition-colors hover:border-primary/10">
              <div className="font-serif text-2xl font-semibold text-foreground">{readingStats.averageSessionTime}</div>
              <div className="text-sm text-muted-foreground">Average Session</div>
            </Card>
            
            <Card className="shadow-none p-4 text-center transition-colors hover:border-primary/10">
              <div className="font-serif text-2xl font-semibold text-foreground">2.3x</div>
              <div className="text-sm text-muted-foreground">Reading Speed Improvement</div>
            </Card>
            
            <Card className="shadow-none p-4 text-center transition-colors hover:border-primary/10">
              <div className="font-serif text-2xl font-semibold text-foreground">94%</div>
              <div className="text-sm text-muted-foreground">Comprehension Rate</div>
            </Card>
          </div>
        </section>
      </div>
    </ContentLayout>
  );
};

export default Dashboard;
