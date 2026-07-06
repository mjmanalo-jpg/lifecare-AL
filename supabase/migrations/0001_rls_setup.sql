-- Create User Role Enum
CREATE TYPE role AS ENUM ('SUPERADMIN', 'NURSE', 'CAREGIVER', 'FAMILY');

-- Create User profiles mapping Supabase Auth
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  role role DEFAULT 'FAMILY'::role NOT NULL,
  email TEXT UNIQUE NOT NULL
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Allow public read profiles" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Allow admin write profiles" ON public.profiles
  FOR ALL TO authenticated USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'SUPERADMIN'::role
  );
