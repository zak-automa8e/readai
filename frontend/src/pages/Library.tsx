import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Trash2, Pencil, Link, Plus, FileText } from "lucide-react";
import { useBooks, Book } from "@/contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { EditBookModal } from "@/components/EditBookModal";
import { useState, useCallback } from "react";
import { generatePdfThumbnail } from "@/lib/pdf-utils";

export default function Library() {
  const { books, addBook, removeBook, setCurrentBook, updateBook } = useBooks();
  const navigate = useNavigate();
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [addBookModalOpen, setAddBookModalOpen] = useState(false);
  const [uploadTab, setUploadTab] = useState("file");

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Validate file type
      if (file.type !== 'application/pdf') {
        console.error('Invalid file type');
        return;
      }

      // Read the file as ArrayBuffer with timeout
      const arrayBuffer = await Promise.race([
        file.arrayBuffer(),
        new Promise<ArrayBuffer>((_, reject) => 
          setTimeout(() => reject(new Error('File reading timeout')), 10000)
        )
      ]);
      
      const pdfData = new Uint8Array(arrayBuffer);
      const defaultCover = await generatePdfThumbnail(pdfData);

      // Add the book to our context with data
      addBook({
        title: file.name.replace(/\.pdf$/i, ''),
        pdfData,
        defaultCover,
      });
      
      // Close modal on successful upload
      setAddBookModalOpen(false);
    } catch (error) {
      console.error('Failed to process PDF:', error);
    } finally {
      // Clear the file input
      event.target.value = '';
    }
  };

  const handleUrlUpload = async () => {
    if (!urlInput.trim()) return;

    setIsLoadingUrl(true);
    try {
      // Validate URL format
      let urlStr = urlInput.trim();
      
      // Handle Google Drive URLs by converting to direct download links
      if (urlStr.includes('drive.google.com')) {
        // Extract file ID from various Google Drive URL formats
        let fileId = '';
        if (urlStr.includes('/file/d/')) {
          fileId = urlStr.split('/file/d/')[1].split('/')[0];
        } else if (urlStr.includes('id=')) {
          fileId = urlStr.split('id=')[1].split('&')[0];
        }
        
        if (fileId) {
          urlStr = `https://drive.google.com/uc?export=download&id=${fileId}`;
          console.log('Converted Google Drive URL to direct download:', urlStr);
        }
      }
      
      const url = new URL(urlStr);
      
      // Fetch the PDF from URL via backend proxy to avoid CORS issues
      const proxyUrl = `http://localhost:3001/api/pdf-proxy?url=${encodeURIComponent(url.toString())}`;
      const response = await Promise.race([
        fetch(proxyUrl),
        new Promise<Response>((_, reject) => 
          setTimeout(() => reject(new Error('URL fetch timeout')), 30000)
        )
      ]);

      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }

      // Get the PDF data
      const arrayBuffer = await response.arrayBuffer();
      const pdfData = new Uint8Array(arrayBuffer);
      
      // Validate that this is actually a PDF by checking the header
      const pdfHeader = pdfData.slice(0, 4);
      const pdfSignature = String.fromCharCode(...pdfHeader);
      if (pdfSignature !== '%PDF') {
        throw new Error('The downloaded file is not a valid PDF. Please check the URL and try again.');
      }
      
      // Check if the content type is PDF (after validation)
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/pdf')) {
        console.warn('Content type is not PDF, but file validation passed:', contentType);
      }
      
      // Generate thumbnail
      const defaultCover = await generatePdfThumbnail(pdfData);

      // Extract filename from URL or use default
      const urlPath = url.pathname;
      const filename = urlPath.split('/').pop() || 'Downloaded PDF';
      const title = filename.replace(/\.pdf$/i, '');

      // Add the book to our context with data
      addBook({
        title,
        pdfData,
        defaultCover,
      });

      // Clear the URL input and close modal
      setUrlInput("");
      setAddBookModalOpen(false);
    } catch (error) {
      console.error('Failed to process PDF from URL:', error);
      
      // Show user-friendly error message
      let errorMessage = 'Failed to add PDF from URL.';
      if (error instanceof Error) {
        if (error.message.includes('not a valid PDF')) {
          errorMessage = error.message;
        } else if (error.message.includes('timeout')) {
          errorMessage = 'The download timed out. Please check your connection and try again.';
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = 'Unable to access the PDF. Please check the URL or try a different link.';
        }
      }
      
      // TODO: Replace with proper toast notification
      alert(errorMessage);
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const handleEditSave = (bookId: string, updates: Partial<Book>) => {
    updateBook(bookId, updates);
    setEditingBook(null);
  };

  const handleBookClick = (book: Book) => {
    setCurrentBook(book);
    navigate('/read');
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-light">Library</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setAddBookModalOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add a book
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {books.map((book) => (
          <Card 
            key={book.id}
            className="glass bg-card/95 p-4 flex flex-col relative cursor-pointer hover:shadow-lg transition-shadow group"
            onClick={() => handleBookClick(book)}
          >
            <div className="aspect-[3/4] bg-muted mb-4 rounded-lg flex items-center justify-center">
              {(book.coverUrl || book.defaultCover) ? (
                <img 
                  src={book.coverUrl || book.defaultCover}
                  alt={book.title}
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <div className="text-muted-foreground text-sm">No Cover</div>
              )}
            </div>
            
            <div className="flex-1">
              <h3 className="font-medium mb-1 line-clamp-2">{book.title}</h3>
              {book.author && (
                <p className="text-sm text-muted-foreground mb-2">{book.author}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Added {new Date(book.uploadDate).toLocaleDateString()}
              </p>
            </div>

            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingBook(book);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBook(book.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}

        {books.length === 0 && (
          <div className="col-span-full text-center p-12 text-muted-foreground">
            No books in your library yet. Add your first book by clicking the button above.
          </div>
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

      {/* Add Book Modal */}
      <Dialog open={addBookModalOpen} onOpenChange={setAddBookModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Add a book
            </DialogTitle>
          </DialogHeader>
          
          <Tabs value={uploadTab} onValueChange={setUploadTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload file
              </TabsTrigger>
              <TabsTrigger value="url" className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                From URL
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="file" className="mt-6">
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Choose a PDF file from your device to add to your library.
                </div>
                <Button
                  variant="outline"
                  className="relative overflow-hidden w-full h-24 border-dashed"
                  size="lg"
                >
                  <div className="flex flex-col items-center">
                    <Upload className="h-6 w-6 mb-2" />
                    <span>Click to select PDF file</span>
                  </div>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="url" className="mt-6">
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Enter a direct link to a PDF file. The file will be downloaded and added to your library.
                </div>
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="Paste PDF URL here..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isLoadingUrl) {
                        handleUrlUpload();
                      }
                    }}
                  />
                  <Button
                    onClick={handleUrlUpload}
                    disabled={!urlInput.trim() || isLoadingUrl}
                  >
                    {isLoadingUrl ? (
                      <>
                        <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Add
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
