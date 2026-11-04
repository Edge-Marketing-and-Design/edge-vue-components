// Shared by the type settings picker and site navigation.
import {
  Archive, Award, BadgePercent, Bell, Bike, Book, BookOpen, Bookmark, BriefcaseBusiness, Building2, CalendarClock, CalendarDays, Camera, Car, ChartNoAxesCombined, ChartPie, ChefHat, Church, CircleHelp, Clapperboard, ClipboardCheck, ClipboardList, Clock, Cloud, Code, Coffee, Compass, Contact, Database, DollarSign, Dumbbell, FileText, Files, Flag, Flower2, Folder, GalleryHorizontalEnd, Gift, Globe, GraduationCap, Hammer, Handshake, HardHat, Headphones, Heart, HeartHandshake, House, Image, Images, Info, Key, Landmark, Leaf, Library, Lightbulb, Link, ListChecks, Lock, Mail, Map, MapPin, Medal, Megaphone, MessageCircle, MessagesSquare, Mic, Monitor, Mountain, Music, Navigation, Newspaper, NotebookPen, Package, Paintbrush, Palette, PartyPopper, PawPrint, PenTool, Pencil, Phone, Plane, Podcast, Quote, Radio, Rocket, Ruler, School, ScrollText, Shield, ShieldCheck, Ship, ShoppingBag, ShoppingCart, Smartphone, Snowflake, Sparkles, Sprout, Star, Stethoscope, Store, Sun, Tags, Terminal, Ticket, Tickets, Trees, Trophy, UserRound, Users, Utensils, Video, Waves, Wrench,
} from 'lucide-vue-next'

export const postTypeIcons = {
  FileText, Newspaper, BookOpen, Book, Library, NotebookPen, ScrollText, CalendarDays, CalendarClock, Ticket, Tickets, PartyPopper, Megaphone, Radio, Podcast, Mic, Video, Clapperboard, Camera, Image, Images, GalleryHorizontalEnd, Music, Headphones, Users, UserRound, Contact, Handshake, Heart, HeartHandshake, MessageCircle, MessagesSquare, Quote, Star, Award, Trophy, Medal, GraduationCap, School, Lightbulb, Sparkles, Rocket, BriefcaseBusiness, Building2, Landmark, Store, ShoppingBag, ShoppingCart, Package, Tags, Gift, BadgePercent, DollarSign, ChartNoAxesCombined, ChartPie, ClipboardList, ClipboardCheck, ListChecks, Folder, Files, Archive, Database, Globe, Map, MapPin, Navigation, Compass, Plane, Car, Bike, Ship, Mountain, Trees, Flower2, Leaf, Sprout, Sun, Cloud, Snowflake, Waves, House, Key, Wrench, Hammer, HardHat, Ruler, Paintbrush, Palette, Pencil, PenTool, Code, Terminal, Monitor, Smartphone, Shield, ShieldCheck, Lock, CircleHelp, Info, Bell, Flag, Bookmark, Link, Mail, Phone, Clock, Coffee, Utensils, ChefHat, Dumbbell, Stethoscope, PawPrint, Church,
}

export const postTypeIconOptions = Object.keys(postTypeIcons).map(value => ({
  value,
  label: value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2'),
}))
