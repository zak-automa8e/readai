import { ContentLayout } from "@/components/layouts/ContentLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Filter, 
  BookOpen, 
  Star, 
  Users, 
  Clock,
  TrendingUp,
  Heart,
  Download
} from "lucide-react";
import { useState } from "react";

const Discover = () => {
  const [searchQuery, setSearchQuery] = useState("");
  
  // Mock data for public books (in production, this would come from your public books API)
  const featuredBooks = [
    {
      id: 1,
      title: "The Art of AI-Assisted Reading",
      author: "Dr. Sarah Chen",
      description: "A comprehensive guide to leveraging artificial intelligence for enhanced reading comprehension and retention.",
      category: "Technology",
      rating: 4.8,
      downloads: 2847,
      readingTime: "3h 20m",
      isPublic: true,
      tags: ["AI", "Education", "Technology"]
    },
    {
      id: 2,
      title: "Mindful Reading Practices",
      author: "Marcus Rodriguez",
      description: "Discover techniques for deeper engagement and mindful consumption of written content.",
      category: "Self-Help",
      rating: 4.6,
      downloads: 1923,
      readingTime: "2h 45m",
      isPublic: true,
      tags: ["Mindfulness", "Reading", "Productivity"]
    },
    {
      id: 3,
      title: "Speed Reading in the Digital Age",
      author: "Lisa Thompson",
      description: "Modern techniques for accelerated reading while maintaining comprehension in our digital world.",
      category: "Education",
      rating: 4.7,
      downloads: 3156,
      readingTime: "4h 10m",
      isPublic: true,
      tags: ["Speed Reading", "Digital", "Efficiency"]
    }
  ];

  const categories = [
    "All", "Technology", "Education", "Self-Help", "Business", "Science", "Fiction", "Non-Fiction"
  ];

  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showFilters, setShowFilters] = useState(false);

  const filteredBooks = featuredBooks.filter(book => {
    const matchesSearch = book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         book.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         book.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || book.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <ContentLayout
      title="Discover"
      description="Explore curated books and community recommendations"
    >
      <div className="space-y-8">
        {/* Search and Filters */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search books, authors, or topics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
              />
            </div>
            <Button 
              variant="outline" 
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
            </Button>
          </div>

          {/* Category Pills */}
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button
                key={category}
                variant={selectedCategory === category ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category)}
                className="rounded-md"
              >
                {category}
              </Button>
            ))}
          </div>
        </section>

        {/* Featured Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl font-semibold text-foreground">Featured Books</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              Trending this week
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBooks.map((book) => (
              <Card 
                key={book.id}
                className="shadow-none overflow-hidden transition-colors cursor-pointer"
              >
                {/* Book Cover */}
                <div className="h-48 bg-muted border-b border-border relative flex items-center justify-center">
                  <BookOpen className="h-12 w-12 text-muted-foreground" />
                  <div className="absolute top-3 end-3">
                    <Badge variant="secondary" className="bg-card text-foreground border-border">
                      <Star className="h-3 w-3 me-1 fill-current" />
                      {book.rating}
                    </Badge>
                  </div>
                </div>

                {/* Book Info */}
                <div className="p-4 space-y-3">
                  <div>
                    <h3 className="font-serif font-semibold text-foreground line-clamp-1">{book.title}</h3>
                    <p className="text-sm text-muted-foreground">by {book.author}</p>
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {book.description}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1">
                    {book.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {book.downloads.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {book.readingTime}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" className="flex-1 gap-1">
                      <Download className="h-3 w-3" />
                      Add to Library
                    </Button>
                    <Button size="sm" variant="outline">
                      <Heart className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Categories Grid */}
        <section className="space-y-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Browse by Category</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {categories.slice(1).map((category) => ( // Skip "All"
              <Card key={category} 
                className="shadow-none p-4 text-center cursor-pointer transition-colors hover:border-primary/40"
                onClick={() => setSelectedCategory(category)}
              >
                <BookOpen className="h-6 w-6 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-medium text-foreground">{category}</h3>
                <p className="text-sm text-muted-foreground">
                  {Math.floor(Math.random() * 50) + 10} books
                </p>
              </Card>
            ))}
          </div>
        </section>

        {/* Coming Soon Notice */}
        <section className="text-center py-12">
          <Card className="shadow-none p-8 max-w-2xl mx-auto">
            <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Public Library Coming Soon
            </h3>
            <p className="text-muted-foreground mb-4">
              We're building a comprehensive public library where users can share and discover 
              amazing books with AI-powered recommendations and community reviews.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline">
                Request Early Access
              </Button>
              <Button variant="outline">
                Submit a Book
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </ContentLayout>
  );
};

export default Discover;
