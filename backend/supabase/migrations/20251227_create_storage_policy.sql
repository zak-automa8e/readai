-- Enable RLS on storage.objects if not already (it usually is)
-- Add policy for readai-media bucket

-- 1. Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('readai-media', 'readai-media', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow public access to the bucket (Simplified for MVP, ideally restrict INSERT to authenticated)
-- Note: 'service_role' key should bypass RLS, but if using anon key or specific setup, these help.

-- Policy for INSERT (Uploads)
CREATE POLICY "Allow authenticated uploads to readai-media"
ON storage.objects FOR INSERT
TO authenticated, public
WITH CHECK (bucket_id = 'readai-media');

-- Policy for SELECT (Public viewing/playback)
CREATE POLICY "Allow public playback from readai-media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'readai-media');

-- Policy for UPDATE/DELETE (Cleanup)
CREATE POLICY "Allow owners to update/delete their files"
ON storage.objects FOR ALL
TO authenticated, public
USING (bucket_id = 'readai-media');
