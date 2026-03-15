# Backend API

The backend service is a Node.js application built with [Hono](https://hono.dev/) and [Prisma](https://www.prisma.io/). It handles the API logic, database interactions, and file storage.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20 or later recommended)
- **Database & MinIO**: Must be running (see [Database Setup](../database/README.md))

## Getting Started

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   **Important:** Open `.env` and configure the database URL, MinIO credentials, and other settings to match your `database/.env` and your security requirements.

4. Run Database Migrations:
   Ensure the database container is running, then apply migrations:
   ```bash
   npx prisma migrate dev
   ```

5. Start the Development Server:
   ```bash
   npm run dev
   ```

   The server will start on **http://localhost:3001**.

## API Documentation

Swagger UI is available at the root path:
- [http://localhost:3001/](http://localhost:3001/)

## Scripts

- `npm run dev`: Starts the development server with hot-reload (and runs `prisma generate`).
- `npm run build`: Compiles the TypeScript code.
- `npm run start`: Runs the built application.
