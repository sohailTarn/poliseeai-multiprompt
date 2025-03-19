# Use a Node.js base image
FROM node:18-slim

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if you have one)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the application source code
COPY . .

# Expose the port that the application listens on
EXPOSE 8080

# Set the environment variable for the port (important for Cloud Run)
ENV PORT=8080

# Command to start the application
CMD [ "node", "index.js" ]