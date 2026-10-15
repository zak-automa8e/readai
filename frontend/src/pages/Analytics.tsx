import { ContentLayout } from "@/components/layouts/ContentLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  TrendingUp, 
  Clock, 
  BookOpen, 
  Target, 
  Calendar,
  Download,
  Share2,
  BarChart3,
  PieChart,
  Activity,
  Zap,
  Award,
  Eye,
  Headphones,
  Brain
} from "lucide-react";
import { useState } from "react";

const Analytics = () => {
  const [timeRange, setTimeRange] = useState("7d");
  
  // Mock analytics data (in production, this would come from your analytics API)
  const analytics = {
    overview: {
      totalReadingTime: 847, // minutes
      booksCompleted: 12,
      averageSession: 42, // minutes
      streak: 15, // days
      weeklyGoal: 300, // minutes
      weeklyProgress: 245, // minutes
    },
    readingPattern: {
      dailyAverage: 121, // minutes
      peakHour: "7:00 PM",
      preferredDay: "Sunday",
      consistency: 78, // percentage
    },
    books: [
      {
        title: "The Science of Learning",
        author: "Dr. Sarah Johnson",
        completionRate: 85,
        timeSpent: 324, // minutes
        chaptersRead: 12,
        totalChapters: 14,
        lastRead: "2024-01-15",
        speed: 1.2,
        notes: 23
      },
      {
        title: "Digital Minimalism",
        author: "Cal Newport",
        completionRate: 100,
        timeSpent: 287,
        chaptersRead: 10,
        totalChapters: 10,
        lastRead: "2024-01-12",
        speed: 1.0,
        notes: 15
      },
      {
        title: "Atomic Habits",
        author: "James Clear",
        completionRate: 45,
        timeSpent: 156,
        chaptersRead: 8,
        totalChapters: 18,
        lastRead: "2024-01-10",
        speed: 1.3,
        notes: 31
      }
    ],
    weeklyData: [
      { day: "Mon", minutes: 45, sessions: 2 },
      { day: "Tue", minutes: 67, sessions: 3 },
      { day: "Wed", minutes: 23, sessions: 1 },
      { day: "Thu", minutes: 89, sessions: 4 },
      { day: "Fri", minutes: 34, sessions: 2 },
      { day: "Sat", minutes: 78, sessions: 3 },
      { day: "Sun", minutes: 102, sessions: 5 }
    ],
    achievements: [
      { id: 1, title: "Speed Reader", description: "Read for 5+ hours this week", earned: true, date: "2024-01-14" },
      { id: 2, title: "Consistent Learner", description: "15-day reading streak", earned: true, date: "2024-01-15" },
      { id: 3, title: "Book Finisher", description: "Complete 10 books", earned: true, date: "2024-01-10" },
      { id: 4, title: "Note Taker", description: "Take 100 notes", earned: false, progress: 69 },
      { id: 5, title: "Voice Explorer", description: "Try 5 different voices", earned: false, progress: 3 }
    ]
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const StatCard = ({ icon: Icon, title, value, subtitle, trend }: any) => (
    <Card className="shadow-none p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="font-serif text-2xl font-semibold text-foreground">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-col items-end space-y-2">
          <Icon className="h-8 w-8 text-primary" />
          {trend && (
            <Badge variant={trend > 0 ? "default" : "secondary"} className="text-xs">
              {trend > 0 ? "+" : ""}{trend}%
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <ContentLayout
      title="Reading Analytics"
      description="Track your reading progress and insights"
    >
      <div className="space-y-8">
        {/* Time Range Selector */}
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-foreground">Overview</h2>
          <div className="flex items-center space-x-4">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 3 months</SelectItem>
                <SelectItem value="1y">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            icon={Clock}
            title="Total Reading Time"
            value={formatTime(analytics.overview.totalReadingTime)}
            subtitle="This week"
            trend={12}
          />
          <StatCard
            icon={BookOpen}
            title="Books Completed"
            value={analytics.overview.booksCompleted}
            subtitle="All time"
            trend={25}
          />
          <StatCard
            icon={Activity}
            title="Average Session"
            value={formatTime(analytics.overview.averageSession)}
            subtitle="Per reading session"
            trend={-5}
          />
          <StatCard
            icon={Target}
            title="Current Streak"
            value={`${analytics.overview.streak} days`}
            subtitle="Daily reading"
            trend={8}
          />
        </div>

        {/* Weekly Goal Progress */}
        <Card className="shadow-none p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Weekly Reading Goal</h3>
              <Badge variant="outline">
                {Math.round((analytics.overview.weeklyProgress / analytics.overview.weeklyGoal) * 100)}% Complete
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {formatTime(analytics.overview.weeklyProgress)} of {formatTime(analytics.overview.weeklyGoal)}
                </span>
                <span className="text-foreground">
                  {formatTime(analytics.overview.weeklyGoal - analytics.overview.weeklyProgress)} remaining
                </span>
              </div>
              <Progress 
                value={(analytics.overview.weeklyProgress / analytics.overview.weeklyGoal) * 100} 
                className="h-3"
              />
            </div>
          </div>
        </Card>

        {/* Detailed Analytics Tabs */}
        <Tabs defaultValue="patterns" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="patterns">Reading Patterns</TabsTrigger>
            <TabsTrigger value="books">Book Progress</TabsTrigger>
            <TabsTrigger value="achievements">Achievements</TabsTrigger>
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
          </TabsList>

          {/* Reading Patterns Tab */}
          <TabsContent value="patterns" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Activity Chart */}
              <Card className="shadow-none p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Daily Reading Activity</h3>
                <div className="space-y-4">
                  {analytics.weeklyData.map((day) => (
                    <div key={day.day} className="flex items-center space-x-4">
                      <div className="w-8 text-sm text-muted-foreground">{day.day}</div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-foreground">{formatTime(day.minutes)}</span>
                          <span className="text-xs text-muted-foreground">{day.sessions} sessions</span>
                        </div>
                        <Progress value={(day.minutes / 120) * 100} className="h-2" />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Reading Insights */}
              <Card className="shadow-none p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Reading Insights</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Daily Average</span>
                    <span className="text-sm font-medium text-foreground">
                      {formatTime(analytics.readingPattern.dailyAverage)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Peak Reading Time</span>
                    <span className="text-sm font-medium text-foreground">
                      {analytics.readingPattern.peakHour}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Most Active Day</span>
                    <span className="text-sm font-medium text-foreground">
                      {analytics.readingPattern.preferredDay}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Reading Consistency</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">
                        {analytics.readingPattern.consistency}%
                      </span>
                      <Badge variant="secondary" className="text-xs">Good</Badge>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Book Progress Tab */}
          <TabsContent value="books" className="space-y-6">
            <div className="space-y-4">
              {analytics.books.map((book, index) => (
                <Card key={index} className="shadow-none p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div>
                        <h3 className="font-semibold text-foreground">{book.title}</h3>
                        <p className="text-sm text-muted-foreground">by {book.author}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Progress</span>
                          <div className="font-medium text-foreground">{book.completionRate}%</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Time Spent</span>
                          <div className="font-medium text-foreground">{formatTime(book.timeSpent)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Reading Speed</span>
                          <div className="font-medium text-foreground">{book.speed}x</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Notes</span>
                          <div className="font-medium text-foreground">{book.notes}</div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Chapter {book.chaptersRead} of {book.totalChapters}
                          </span>
                          <span className="text-muted-foreground">
                            Last read: {new Date(book.lastRead).toLocaleDateString()}
                          </span>
                        </div>
                        <Progress value={book.completionRate} className="h-2" />
                      </div>
                    </div>

                    <div className="ms-4">
                      <Badge variant={book.completionRate === 100 ? "default" : "secondary"}>
                        {book.completionRate === 100 ? "Completed" : "In Progress"}
                      </Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Achievements Tab */}
          <TabsContent value="achievements" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {analytics.achievements.map((achievement) => (
                <Card key={achievement.id} className={`shadow-none p-6 ${achievement.earned ? 'border-primary/40' : ''}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                      <Award className={`h-6 w-6 ${achievement.earned ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div>
                        <h3 className={`font-semibold ${achievement.earned ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {achievement.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">{achievement.description}</p>
                      </div>
                      
                      {achievement.earned ? (
                        <div className="flex items-center space-x-2">
                          <Badge variant="default" className="text-xs">Earned</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(achievement.date!).toLocaleDateString()}
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Progress</span>
                            <span className="text-foreground">{achievement.progress}/100</span>
                          </div>
                          <Progress value={achievement.progress} className="h-2" />
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* AI Insights Tab */}
          <TabsContent value="insights" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="shadow-none p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Brain className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Reading Recommendations</h3>
                </div>
                <div className="space-y-4">
                  <div className="p-4 rounded-md bg-muted border border-border">
                    <p className="text-sm text-foreground mb-2">
                      <strong>Optimal Reading Time:</strong> Your peak focus appears to be between 7-9 PM. 
                      Consider scheduling longer reading sessions during this window.
                    </p>
                  </div>
                  <div className="p-4 rounded-md bg-muted border border-border">
                    <p className="text-sm text-foreground mb-2">
                      <strong>Speed Optimization:</strong> You're reading 23% faster than average. 
                      Try increasing to 1.4x speed for technical content to maintain comprehension.
                    </p>
                  </div>
                  <div className="p-4 rounded-md bg-muted border border-border">
                    <p className="text-sm text-foreground mb-2">
                      <strong>Note-Taking Pattern:</strong> Your retention improves 34% when you take notes. 
                      Consider the Cornell note-taking method for better organization.
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="shadow-none p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Zap className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Performance Insights</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/10">
                    <div className="flex items-center space-x-3">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Focus Score</span>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-medium text-foreground">87%</div>
                      <div className="text-xs text-muted-foreground">Above average</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/10">
                    <div className="flex items-center space-x-3">
                      <Headphones className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Audio Engagement</span>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-medium text-foreground">92%</div>
                      <div className="text-xs text-muted-foreground">Excellent</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/10">
                    <div className="flex items-center space-x-3">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Learning Velocity</span>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-medium text-foreground">+15%</div>
                      <div className="text-xs text-muted-foreground">This month</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <Button className="gap-2">
            <Share2 className="h-4 w-4" />
            Share Progress
          </Button>
          <Button variant="outline" className="gap-2">
            <Calendar className="h-4 w-4" />
            Set Reading Goals
          </Button>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export Data
          </Button>
        </div>
      </div>
    </ContentLayout>
  );
};

export default Analytics;
