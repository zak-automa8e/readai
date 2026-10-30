import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Grid, List, SortAsc, SortDesc, Filter, FileText } from "lucide-react";
import { useBooks, Book } from "@/contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { EditBookModal } from "@/components/EditBookModal";
import { AddBookModal } from "@/components/AddBookModal";
import { Dialog as ConfirmDialog, DialogContent as ConfirmDialogContent, DialogHeader as ConfirmDialogHeader, DialogTitle as ConfirmDialogTitle } from "@/components/ui/dialog";
import { useState, useCallback, useEffect } from "react";
import { ContentLayout } from "@/components/layouts/ContentLayout";
import { BookGridCard, BookListRow } from "@/components/library/LibraryBookItems";

export default function Library() {
  const { books, removeBook, setCurrentBook, updateBook, loading, error } = useBooks();
  const navigate = useNavigate();
  
  // Remove verbose state logs to keep console clean
  
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [confirmDeleteBook, setConfirmDeleteBook] = useState<Book | null>(null);
  const [addBookModalOpen, setAddBookModalOpen] = useState(false);
  
  // New state for enhanced library features
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'title' | 'date' | 'author'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterBy, setFilterBy] = useState<'all' | 'recent' | 'favorites'>('all');

  const handleEditSave = async (bookId: string, updates: Partial<Book> & { coverFile?: File }) => {
    await updateBook(bookId, updates);
    setEditingBook(null);
  };

  const handleBookClick = (book: Book) => {
    setCurrentBook(book);
    navigate('/read');
  };

  // Filter and sort books
  const filteredAndSortedBooks = books
    .filter(book => {
      const matchesSearch = book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (book.author || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      if (filterBy === 'recent') {
        const isRecent = new Date(book.uploadDate).getTime() > Date.now() - (7 * 24 * 60 * 60 * 1000);
        return matchesSearch && isRecent;
      }
      
      return matchesSearch;
    })
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'author':
          comparison = (a.author || '').localeCompare(b.author || '');
          break;
        case 'date':
          comparison = new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime();
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  return (
    <ContentLayout
      title="Library"
      description="Manage your book collection and discover new content"
    >
      <div className="space-y-6">
        {/* Library Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-none p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Books</p>
                <p className="font-serif text-2xl font-semibold text-foreground">{books.length}</p>
              </div>
              <Grid className="w-4 h-4 text-muted-foreground" />
            </div>
          </Card>
          
          <Card className="shadow-none p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Recent Uploads</p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {books.filter(book => 
                    new Date(book.uploadDate).getTime() > Date.now() - (7 * 24 * 60 * 60 * 1000)
                  ).length}
                </p>
              </div>
              <SortAsc className="w-4 h-4 text-muted-foreground" />
            </div>
          </Card>
          
          <Card className="shadow-none p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Pages</p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {books.length > 0 ? (books.length * 150) : 0}
                </p>
              </div>
              <List className="w-4 h-4 text-muted-foreground" />
            </div>
          </Card>
          
          <Card className="shadow-none p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Storage Used</p>
                <p className="font-serif text-2xl font-semibold text-foreground">
                  {books.length > 0 ? `${(books.length * 2.5).toFixed(1)}MB` : '0MB'}
                </p>
              </div>
              <Filter className="w-4 h-4 text-muted-foreground" />
            </div>
          </Card>
        </div>

        {/* Quick Upload Section */}
        <Card className="shadow-none p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg font-semibold text-foreground">Add New Book</h2>
            <Button
              variant="outline"
              onClick={() => setAddBookModalOpen(true)}
            >
              <Plus className="h-4 w-4 me-2" />
              Add Book
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Upload PDF files from your device or add books via URL to expand your library
          </p>
        </Card>

        {/* Search and Filter Controls */}
        <Card className="shadow-none p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search books by title or author..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                />
              </div>

              {/* Filter */}
              <Select value={filterBy} onValueChange={(value: any) => setFilterBy(value)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Books</SelectItem>
                  <SelectItem value="recent">Recent</SelectItem>
                  <SelectItem value="favorites">Favorites</SelectItem>
                </SelectContent>
              </Select>

              {/* Sort */}
              <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Date Added</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                  <SelectItem value="author">Author</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* View Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant={sortOrder === 'asc' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="w-10 h-10 p-0"
              >
                {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
              </Button>
              
              <div className="flex rounded-md border border-border">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="rounded-e-none border-e border-border"
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="rounded-s-none"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Active Filters Display */}
          {(searchTerm || filterBy !== 'all') && (
            <div className="flex items-center gap-2 mt-4">
              <span className="text-sm text-muted-foreground">Active filters:</span>
              {searchTerm && (
                <Badge variant="secondary" className="text-xs">
                  Search: "{searchTerm}"
                  <button
                    onClick={() => setSearchTerm("")}
                    className="ms-1 hover:text-destructive"
                  >
                    ×
                  </button>
                </Badge>
              )}
              {filterBy !== 'all' && (
                <Badge variant="secondary" className="text-xs">
                  Filter: {filterBy}
                  <button
                    onClick={() => setFilterBy('all')}
                    className="ms-1 hover:text-destructive"
                  >
                    ×
                  </button>
                </Badge>
              )}
            </div>
          )}
        </Card>

        {/* Books Grid/List */}
        <div className={
          viewMode === 'grid' 
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            : "space-y-4"
        }>
          {filteredAndSortedBooks.length > 0 ? (
            filteredAndSortedBooks.map((book) => (
              viewMode === 'grid' ? (
                <BookGridCard
                  key={book.id}
                  book={book}
                  loading={loading}
                  onOpen={() => handleBookClick(book)}
                  onEdit={() => setEditingBook(book)}
                  onDelete={() => setConfirmDeleteBook(book)}
                />
              ) : (
                <BookListRow
                  key={book.id}
                  book={book}
                  onOpen={() => handleBookClick(book)}
                  onEdit={() => setEditingBook(book)}
                  onDelete={() => removeBook(book.id)}
                />
              )
            ))
          ) : books.length === 0 ? (
            <Card className="shadow-none p-12 text-center col-span-full">
              <div className="mx-auto w-16 h-16 bg-muted rounded-md flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-serif text-xl font-semibold text-foreground mb-2">No books in your library</h3>
              <p className="text-muted-foreground mb-6">
                Upload your first book to get started with AI-powered reading
              </p>
              <Button onClick={() => setAddBookModalOpen(true)}>
                <Plus className="h-4 w-4 me-2" />
                Add Your First Book
              </Button>
            </Card>
          ) : (
            <Card className="shadow-none p-12 text-center col-span-full">
              <div className="mx-auto w-16 h-16 bg-muted rounded-md flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-serif text-xl font-semibold text-foreground mb-2">No books found</h3>
              <p className="text-muted-foreground mb-6">
                Try adjusting your search terms or filters
              </p>
              <Button variant="outline" onClick={() => {
                setSearchTerm("");
                setFilterBy('all');
              }}>
                Clear Filters
              </Button>
            </Card>
          )}
        </div>

        {editingBook && (
          <EditBookModal
            book={editingBook}
            isOpen={true}
            onClose={() => setEditingBook(null)}
            onSave={(updates) => handleEditSave(editingBook.id, updates)}
          />
        )}

        {/* Delete confirmation dialog */}
        {confirmDeleteBook && (
          <ConfirmDialog open={true} onOpenChange={() => setConfirmDeleteBook(null)}>
            <ConfirmDialogContent className="sm:max-w-md">
              <ConfirmDialogHeader>
                <ConfirmDialogTitle>Delete Book</ConfirmDialogTitle>
              </ConfirmDialogHeader>
              <div className="mb-4">Are you sure you want to remove <span className="font-semibold">{confirmDeleteBook.title}</span> from your library?</div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmDeleteBook(null)} disabled={loading}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await removeBook(confirmDeleteBook.id);
                    setConfirmDeleteBook(null);
                  }}
                  disabled={loading}
                >
                  Delete
                </Button>
              </div>
            </ConfirmDialogContent>
          </ConfirmDialog>
        )}

        {/* Add Book Modal */}
        <AddBookModal 
          isOpen={addBookModalOpen} 
          onClose={() => setAddBookModalOpen(false)} 
        />
      </div>
    </ContentLayout>
  );
}
