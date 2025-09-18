import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { 
  Upload, 
  Link, 
  FileText, 
  X, 
  Check, 
  AlertCircle, 
  Loader2,
  RefreshCw,
  Eye,
  Plus,
  ArrowLeft
} from "lucide-react";
import { useBooks, Book } from "@/contexts/BooksContext";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

interface AddBookModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type UploadState = 'idle' | 'fileSelected' | 'uploading' | 'success' | 'error';
type UploadMethod = 'file' | 'url';

interface SelectedFileInfo {
  file: File;
  name: string;
  size: number;
  sizeFormatted: string;
}

interface BookMetadata {
  title: string;
  author: string;
  description: string;
}

export function AddBookModal({ isOpen, onClose }: AddBookModalProps) {
  const { uploadPDF, addBook, setCurrentBook } = useBooks();
  const navigate = useNavigate();
  
  // Core state
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>('file');
  const [selectedFile, setSelectedFile] = useState<SelectedFileInfo | null>(null);
  const [metadata, setMetadata] = useState<BookMetadata>({
    title: '',
    author: '',
    description: ''
  });
  const [urlInput, setUrlInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadedBook, setUploadedBook] = useState<Book | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Format file size helper
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  // Reset modal state
  const resetModal = useCallback(() => {
    setUploadState('idle');
    setUploadMethod('file');
    setSelectedFile(null);
    setMetadata({ title: '', author: '', description: '' });
    setUrlInput('');
    setErrorMessage('');
    setUploadedBook(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Handle modal close
  const handleClose = useCallback(() => {
    resetModal();
    onClose();
  }, [resetModal, onClose]);

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      toast({
        title: "Invalid File",
        description: "Please upload a PDF file",
        variant: "destructive"
      });
      return;
    }

    const fileInfo: SelectedFileInfo = {
      file,
      name: file.name,
      size: file.size,
      sizeFormatted: formatFileSize(file.size)
    };

    setSelectedFile(fileInfo);
    
    // Pre-fill metadata from filename
    const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
    setMetadata(prev => ({
      ...prev,
      title: title
    }));
    
    setUploadState('fileSelected');
    setErrorMessage('');
  };

  // Handle different file selection
  const handleChooseDifferentFile = () => {
    setSelectedFile(null);
    setMetadata({ title: '', author: '', description: '' });
    setUploadState('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle file upload
  const handleFileUpload = async () => {
    if (!selectedFile) return;

    setUploadState('uploading');
    setErrorMessage('');

    try {
      const book = await uploadPDF(selectedFile.file, {
        title: metadata.title.trim() || selectedFile.name.replace(/\.pdf$/i, ''),
        author: metadata.author.trim() || undefined,
        description: metadata.description.trim() || undefined
      });

      setUploadedBook(book);
      setUploadState('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload PDF';
      setErrorMessage(message);
      setUploadState('error');
    }
  };

  // Handle URL upload
  const handleUrlUpload = async () => {
    if (!urlInput.trim()) return;

    setUploadState('uploading');
    setErrorMessage('');

    try {
      // Validate URL format
      let urlStr = urlInput.trim();
      
      // Handle Google Drive URLs by converting to direct download links
      if (urlStr.includes('drive.google.com')) {
        let fileId = '';
        if (urlStr.includes('/file/d/')) {
          fileId = urlStr.split('/file/d/')[1].split('/')[0];
        } else if (urlStr.includes('id=')) {
          fileId = urlStr.split('id=')[1].split('&')[0];
        }
        if (fileId) {
          urlStr = `https://drive.google.com/uc?export=download&id=${fileId}`;
        }
      }
      
      const url = new URL(urlStr);
      
      // Extract filename from URL or use default
      const urlPath = url.pathname;
      const filename = urlPath.split('/').pop() || 'Downloaded PDF';
      const title = filename.replace(/\.pdf$/i, '');

      // Create book from URL using the backend API
      const bookId = await addBook({
        title,
        pdf_url: urlStr,
        pdf_source: 'url',
      });

      // Note: For URL uploads, we don't get the full book object back immediately
      // so we'll show a simplified success state
      setUploadState('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add book from URL';
      setErrorMessage(message);
      setUploadState('error');
    }
  };

  // Handle view book
  const handleViewBook = () => {
    if (uploadedBook) {
      setCurrentBook(uploadedBook);
      handleClose();
      navigate('/read');
    }
  };

  // Handle add another book
  const handleAddAnother = () => {
    resetModal();
  };

  // Render different stages
  const renderIdleState = () => (
    <Tabs value={uploadMethod} onValueChange={(value) => setUploadMethod(value as UploadMethod)} className="w-full">
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
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center">
              <Upload className="h-6 w-6 mb-2" />
              <span>Click to select PDF file</span>
            </div>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
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
              className="flex-1 min-w-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && urlInput.trim()) {
                  handleUrlUpload();
                }
              }}
            />
            <Button
              onClick={handleUrlUpload}
              disabled={!urlInput.trim()}
              className="flex-shrink-0"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );

  const renderFileSelectedState = () => (
    <div className="space-y-6">
      {/* Selected file info */}
      <div className="border rounded-lg p-4 bg-muted/50">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium text-sm truncate flex-1 min-w-0">{selectedFile?.name}</h4>
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                {selectedFile?.sizeFormatted}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">PDF Document</p>
          </div>
        </div>
      </div>

      {/* Metadata form */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Book Title *</Label>
          <Input
            id="title"
            value={metadata.title}
            onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Enter book title"
            className="w-full min-w-0"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="author">Author (Optional)</Label>
          <Input
            id="author"
            value={metadata.author}
            onChange={(e) => setMetadata(prev => ({ ...prev, author: e.target.value }))}
            placeholder="Enter author name"
            className="w-full min-w-0"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description (Optional)</Label>
          <Textarea
            id="description"
            value={metadata.description}
            onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Enter book description"
            className="w-full min-w-0 resize-none"
            rows={3}
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleChooseDifferentFile}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Choose Different File
        </Button>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleFileUpload}
            disabled={!metadata.title.trim()}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Upload Book
          </Button>
        </div>
      </div>
    </div>
  );

  const renderUploadingState = () => (
    <div className="text-center py-8 space-y-4">
      <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
      </div>
      <div>
        <h3 className="font-medium text-lg">Uploading your book...</h3>
        <p className="text-muted-foreground text-sm">
          Please wait while we process your {uploadMethod === 'file' ? 'PDF file' : 'book URL'}
        </p>
      </div>
      <div className="text-xs text-muted-foreground">
        This may take a few moments for larger files
      </div>
    </div>
  );

  const renderSuccessState = () => (
    <div className="text-center py-6 space-y-6">
      <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
        <Check className="h-8 w-8 text-green-500" />
      </div>
      
      <div>
        <h3 className="font-medium text-lg">Book added successfully!</h3>
        <p className="text-muted-foreground text-sm">
          Your book has been uploaded and is ready to read
        </p>
      </div>

      {uploadedBook && (
        <div className="border rounded-lg p-4 bg-muted/50 text-left">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-green-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate">{uploadedBook.title}</h4>
              {uploadedBook.author && (
                <p className="text-xs text-muted-foreground truncate">by {uploadedBook.author}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Added {new Date(uploadedBook.uploadDate).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {uploadedBook && (
          <Button onClick={handleViewBook} className="gap-2">
            <Eye className="h-4 w-4" />
            Read Book Now
          </Button>
        )}
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleAddAnother} className="gap-2 flex-1">
            <Plus className="h-4 w-4" />
            Add Another Book
          </Button>
          <Button variant="outline" onClick={handleClose} className="flex-1">
            Close
          </Button>
        </div>
      </div>
    </div>
  );

  const renderErrorState = () => (
    <div className="text-center py-6 space-y-6">
      <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
        <AlertCircle className="h-8 w-8 text-red-500" />
      </div>
      
      <div>
        <h3 className="font-medium text-lg">Upload failed</h3>
        <p className="text-muted-foreground text-sm">
          There was an error uploading your book
        </p>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button 
          onClick={() => {
            if (uploadMethod === 'file') {
              setUploadState('fileSelected');
            } else {
              setUploadState('idle');
            }
            setErrorMessage('');
          }}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Button>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUploadState('idle')} className="flex-1">
            Choose Different File
          </Button>
          <Button variant="outline" onClick={handleClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );

  const getModalTitle = () => {
    switch (uploadState) {
      case 'idle':
        return 'Add a book';
      case 'fileSelected':
        return 'Book details';
      case 'uploading':
        return 'Uploading book';
      case 'success':
        return 'Upload complete';
      case 'error':
        return 'Upload failed';
      default:
        return 'Add a book';
    }
  };

  const getModalContent = () => {
    switch (uploadState) {
      case 'idle':
        return renderIdleState();
      case 'fileSelected':
        return renderFileSelectedState();
      case 'uploading':
        return renderUploadingState();
      case 'success':
        return renderSuccessState();
      case 'error':
        return renderErrorState();
      default:
        return renderIdleState();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-md max-w-[95vw] w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {getModalTitle()}
          </DialogTitle>
        </DialogHeader>
        
        <div className="min-w-0">
          {getModalContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
